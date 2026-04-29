import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import http from './http.js'
import {
  AGENT_ACTIVE_SESSION_KEY,
  AGENT_AI_ID_KEY,
  AGENT_AI_MODEL_KEY
} from './storage.js'

const NEW_SESSION_TITLE = '新对话'
const UNSELECTED_MODEL_LABEL = '未选择模型'
const UNSELECTED_AGENT_LABEL = '未选择 Agent 配置'
const LOADING_REPLY_SUMMARY = '正在生成首轮回复...'
const WAITING_FOR_GOAL_SUMMARY = '等待你给出第一个目标，我会围绕当前会话持续推进。'
const AI_CONFIG_REQUEST_TIMEOUT = 10000
const TASK_POLL_INTERVAL_MS = 2500
const RUNNING_TASK_STATUSES = new Set(['queued', 'pending', 'running', 'in_progress'])
const CODING_MODE_PATTERNS = [
  /代码|改代码|写代码|编程|重构|修复|bug|报错|报错信息|新增文件|新建文件|创建文件|修改文件|读文件|写文件|函数|组件|接口|脚本|构建|打包|依赖|样式|css|html|js|ts|tsx|jsx|vue|react|node|npm/i,
  /\b(code|coding|bug|fix|refactor|file|files|component|function|api|build|patch|write|read|debug|test|lint|typescript|javascript|vue|react|node|npm)\b/i
]

function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function') {
    return storage
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage
  }

  return null
}

function readStorageValue(storage, storageKey) {
  if (!storage) {
    return ''
  }

  return String(storage.getItem(storageKey) || '').trim()
}

function writeStorageValue(storage, storageKey, value) {
  if (!storage) {
    return
  }

  const normalized = String(value || '').trim()

  if (!normalized) {
    storage.removeItem(storageKey)
    return
  }

  storage.setItem(storageKey, normalized)
}

function normalizeErrorMessage(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage
}

function normalizeNotify(notify) {
  return typeof notify === 'function' ? notify : () => {}
}

function normalizeConfirmDelete(confirmDelete) {
  return typeof confirmDelete === 'function' ? confirmDelete : () => true
}

function parseAiVersions(value) {
  return [...new Set(
    String(value ?? '')
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )]
}

function normalizeAiConfigOption(item) {
  const aiId = String(item?.aiId || '').trim()
  const aiBaseUrl = String(item?.aiBaseUrl || '').trim()

  if (!aiId || !item?.hasApiKey || !aiBaseUrl) {
    return null
  }

  return {
    aiId,
    label: String(item?.name || aiId).trim() || aiId,
    versions: parseAiVersions(item?.aiVersions),
    aiBaseUrl
  }
}

function createFallbackSessionTitle(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ')

  if (!normalized) {
    return NEW_SESSION_TITLE
  }

  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized
}

function sortAgentSessionsByUpdatedAt(items) {
  return [...items].sort((left, right) => (
    String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || ''))
  ))
}

function cloneValue(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value
}

function normalizeTaskStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function isTaskRunning(task) {
  return RUNNING_TASK_STATUSES.has(normalizeTaskStatus(task?.status))
}

function detectCodingIntent(value) {
  const normalized = String(value || '').trim()

  if (!normalized) {
    return false
  }

  return CODING_MODE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function useAgentWorkspace({ storage, notify, confirmDelete } = {}) {
  const resolvedStorage = resolveStorage(storage)
  const emitNotify = normalizeNotify(notify)
  const resolveDeleteConfirmation = normalizeConfirmDelete(confirmDelete)

  const sessions = ref([])
  const activeSessionId = ref(readStorageValue(resolvedStorage, AGENT_ACTIVE_SESSION_KEY))
  const activeSession = ref(null)
  const draft = ref('')
  const loadError = ref('')
  const sessionError = ref('')
  const chatError = ref('')
  const isLoadingSessions = ref(false)
  const isLoadingSession = ref(false)
  const isSending = ref(false)
  const isCreatingSession = ref(false)
  const aiConfigs = ref([])
  const isLoadingAiConfigs = ref(false)
  const selectedAiId = ref(readStorageValue(resolvedStorage, AGENT_AI_ID_KEY))
  const selectedModel = ref(readStorageValue(resolvedStorage, AGENT_AI_MODEL_KEY))
  const isRefreshingActiveSession = ref(false)
  const isCancellingTask = ref(false)
  const selectedWorkspaceFilePath = ref('')
  const selectedWorkspaceFileContent = ref('')
  const selectedWorkspaceFileUpdatedAt = ref('')
  const selectedWorkspaceFileSizeBytes = ref(null)
  const isLoadingWorkspaceFile = ref(false)
  const workspaceFileError = ref('')

  const activeMessages = computed(() => (
    Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages.filter((item) => String(item?.role || '').trim().toLowerCase() !== 'tool')
      : []
  ))
  const currentTask = computed(() => activeSession.value?.task || null)
  const activeWorkspaceFolder = computed(() => String(activeSession.value?.workspaceFolder || '').trim())
  const activeWorkspaceFiles = computed(() => (
    Array.isArray(activeSession.value?.workspaceFiles) ? activeSession.value.workspaceFiles : []
  ))
  const isAgentRunning = computed(() => isTaskRunning(currentTask.value))
  const activeSkillId = computed(() => String(activeSession.value?.lastSkillId || '').trim())
  const selectedAiConfig = computed(
    () => aiConfigs.value.find((item) => item.aiId === selectedAiId.value) || null
  )
  const modelOptions = computed(() => selectedAiConfig.value?.versions || [])
  const selectedModelLabel = computed(() => selectedModel.value || UNSELECTED_MODEL_LABEL)
  const selectedAgentLabel = computed(() => selectedAiConfig.value?.label || UNSELECTED_AGENT_LABEL)
  const hasDraftCodingIntent = computed(() => detectCodingIntent(draft.value))
  const workspaceMode = computed(() => {
    if (activeSkillId.value === 'coding_agent') {
      return {
        id: 'coding',
        label: '编码模式',
        tone: 'coding',
        hint: '可直接读取、修改并验证工作区文件。'
      }
    }

    if (hasDraftCodingIntent.value) {
      return {
        id: 'coding-preview',
        label: '编码模式',
        tone: 'coding',
        hint: '本次请求看起来像代码或文件任务，将按编码模式处理。'
      }
    }

    return {
      id: 'chat',
      label: '对话模式',
      tone: 'chat',
      hint: '当前更像普通问答或讨论，不一定会改动文件。'
    }
  })
  const canSend = computed(() => Boolean(
    draft.value.trim()
    && !isSending.value
    && !isLoadingSession.value
    && !isAgentRunning.value
  ))

  let taskPollTimer = null
  let sessionLoadToken = 0

  function persistActiveSessionId() {
    writeStorageValue(resolvedStorage, AGENT_ACTIVE_SESSION_KEY, activeSessionId.value)
  }

  function persistSelectedAi() {
    writeStorageValue(resolvedStorage, AGENT_AI_ID_KEY, selectedAiId.value)
    writeStorageValue(resolvedStorage, AGENT_AI_MODEL_KEY, selectedModel.value)
  }

  function stopTaskPolling() {
    if (typeof window === 'undefined' || taskPollTimer === null) {
      return
    }

    window.clearTimeout(taskPollTimer)
    taskPollTimer = null
  }

  function upsertSessionSummary(item) {
    if (!item?.sessionId) {
      return
    }

    const existingIndex = sessions.value.findIndex((entry) => entry.sessionId === item.sessionId)

    if (existingIndex === -1) {
      sessions.value = sortAgentSessionsByUpdatedAt([item, ...sessions.value])
      return
    }

    const nextSessions = [...sessions.value]
    nextSessions.splice(existingIndex, 1, {
      ...nextSessions[existingIndex],
      ...item
    })
    sessions.value = sortAgentSessionsByUpdatedAt(nextSessions)
  }

  function removeSessionSummary(sessionId) {
    sessions.value = sessions.value.filter((item) => item.sessionId !== sessionId)
  }

  function resetWorkspaceFilePreview() {
    selectedWorkspaceFilePath.value = ''
    selectedWorkspaceFileContent.value = ''
    selectedWorkspaceFileUpdatedAt.value = ''
    selectedWorkspaceFileSizeBytes.value = null
    isLoadingWorkspaceFile.value = false
    workspaceFileError.value = ''
  }

  function ensureSelectedModel() {
    const config = selectedAiConfig.value
    const availableModels = config?.versions || []

    if (!config) {
      if (aiConfigs.value.length) {
        selectedAiId.value = aiConfigs.value[0].aiId
        ensureSelectedModel()
      } else {
        selectedAiId.value = ''
        selectedModel.value = ''
      }

      persistSelectedAi()
      return
    }

    if (!selectedModel.value || !availableModels.includes(selectedModel.value)) {
      selectedModel.value = availableModels[0] || ''
    }

    persistSelectedAi()
  }

  async function loadAiConfigs() {
    isLoadingAiConfigs.value = true
    loadError.value = ''

    try {
      const data = await http.get('/api/ai/configs', {
        timeout: AI_CONFIG_REQUEST_TIMEOUT
      })
      aiConfigs.value = Array.isArray(data.items)
        ? data.items.map((item) => normalizeAiConfigOption(item)).filter(Boolean)
        : []
      ensureSelectedModel()
    } catch (error) {
      aiConfigs.value = []
      loadError.value = normalizeErrorMessage(error, '读取 Agent 配置失败。')
    } finally {
      isLoadingAiConfigs.value = false
    }
  }

  async function loadSessions() {
    isLoadingSessions.value = true
    sessionError.value = ''

    try {
      const data = await http.get('/api/agent/sessions')
      sessions.value = sortAgentSessionsByUpdatedAt(Array.isArray(data.items) ? data.items : [])

      if (activeSessionId.value && sessions.value.some((item) => item.sessionId === activeSessionId.value)) {
        return
      }

      activeSessionId.value = sessions.value[0]?.sessionId || ''
      persistActiveSessionId()
    } catch (error) {
      sessionError.value = normalizeErrorMessage(error, '读取会话列表失败。')
    } finally {
      isLoadingSessions.value = false
    }
  }

  async function loadSessionDetail(
    sessionId,
    {
      silent = false,
      preserveChatError = false,
      asBackgroundRefresh = false
    } = {}
  ) {
    const normalizedSessionId = String(sessionId || '').trim()
    const requestToken = ++sessionLoadToken

    if (!normalizedSessionId) {
      stopTaskPolling()
      activeSession.value = null
      activeSessionId.value = ''
      persistActiveSessionId()
      resetWorkspaceFilePreview()
      return
    }

    if (!silent) {
      isLoadingSession.value = true
    }

    if (!preserveChatError) {
      chatError.value = ''
    }

    if (asBackgroundRefresh) {
      isRefreshingActiveSession.value = true
    }

    try {
      const data = await http.get(`/api/agent/sessions/${normalizedSessionId}`)

      if (requestToken !== sessionLoadToken) {
        return
      }

      activeSession.value = data.item || null
      activeSessionId.value = activeSession.value?.sessionId || normalizedSessionId
      persistActiveSessionId()

      if (
        selectedWorkspaceFilePath.value
        && !activeWorkspaceFiles.value.some((item) => item.path === selectedWorkspaceFilePath.value)
      ) {
        resetWorkspaceFilePreview()
      }

      if (activeSession.value) {
        upsertSessionSummary(activeSession.value)
      }
    } catch (error) {
      if (!preserveChatError || !chatError.value) {
        chatError.value = normalizeErrorMessage(error, '读取会话详情失败。')
      }
    } finally {
      if (!silent) {
        isLoadingSession.value = false
      }

      if (asBackgroundRefresh) {
        isRefreshingActiveSession.value = false
      }
    }
  }

  function scheduleTaskPolling() {
    if (typeof window === 'undefined') {
      return
    }

    stopTaskPolling()

    if (!activeSessionId.value || !isAgentRunning.value) {
      return
    }

    taskPollTimer = window.setTimeout(async () => {
      taskPollTimer = null

      try {
        await loadSessionDetail(activeSessionId.value, {
          silent: true,
          preserveChatError: true,
          asBackgroundRefresh: true
        })
      } finally {
        scheduleTaskPolling()
      }
    }, TASK_POLL_INTERVAL_MS)
  }

  async function createSessionEntry() {
    if (isCreatingSession.value) {
      return
    }

    isCreatingSession.value = true
    chatError.value = ''

    try {
      const data = await http.post('/api/agent/sessions')
      const item = data.item || null

      if (!item?.sessionId) {
        throw new Error('Agent session creation returned an invalid payload.')
      }

      activeSession.value = item
      activeSessionId.value = item.sessionId
      persistActiveSessionId()
      upsertSessionSummary(item)
      draft.value = ''
    } catch (error) {
      chatError.value = normalizeErrorMessage(error, '新建会话失败。')
    } finally {
      isCreatingSession.value = false
    }
  }

  async function deleteSession(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId) {
      return
    }

    const confirmed = await Promise.resolve(
      resolveDeleteConfirmation({
        sessionId: normalizedSessionId,
        activeSessionId: activeSessionId.value
      })
    )

    if (!confirmed) {
      return
    }

    try {
      await http.delete(`/api/agent/sessions/${normalizedSessionId}`)
      removeSessionSummary(normalizedSessionId)

      if (activeSessionId.value === normalizedSessionId) {
        const nextSessionId = sessions.value[0]?.sessionId || ''
        activeSession.value = null
        activeSessionId.value = nextSessionId
        persistActiveSessionId()
        resetWorkspaceFilePreview()

        if (nextSessionId) {
          await loadSessionDetail(nextSessionId)
        }
      }
    } catch (error) {
      emitNotify({
        message: normalizeErrorMessage(error, '删除会话失败。'),
        type: 'danger'
      })
    }
  }

  async function selectSession(sessionId) {
    if (!sessionId || sessionId === activeSessionId.value) {
      return
    }

    activeSessionId.value = sessionId
    persistActiveSessionId()
    await loadSessionDetail(sessionId)
  }

  function setSelectedAiId(nextAiId) {
    selectedAiId.value = String(nextAiId || '').trim()
    ensureSelectedModel()
  }

  function setSelectedModel(nextModel) {
    selectedModel.value = String(nextModel || '').trim()
    persistSelectedAi()
  }

  function ensureSendReady(message) {
    if (!message) {
      return false
    }

    if (isAgentRunning.value) {
      chatError.value = '当前任务仍在执行，请等待 Agent 完成这一轮推进。'
      return false
    }

    if (isLoadingAiConfigs.value && !selectedAiId.value && !selectedModel.value) {
      chatError.value = '正在读取 Agent 配置，请稍后再试。'
      return false
    }

    if (!selectedAiId.value) {
      chatError.value = loadError.value || '请先选择 Agent 配置。'
      return false
    }

    if (!selectedModel.value) {
      chatError.value = modelOptions.value.length
        ? '请先选择模型版本。'
        : loadError.value || '当前 Agent 配置没有可用模型版本。'
      return false
    }

    return true
  }

  async function sendMessage() {
    const message = draft.value.trim()

    if (!ensureSendReady(message)) {
      return
    }

    const previousActiveSession = cloneValue(activeSession.value)
    const optimisticSessionId = activeSessionId.value || 'pending-session'
    const optimisticSession = previousActiveSession || {
      sessionId: optimisticSessionId,
      title: createFallbackSessionTitle(message),
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      lastAiId: selectedAiId.value,
      lastModel: selectedModel.value,
      task: {
        taskId: 'pending-task',
        title: createFallbackSessionTitle(message),
        status: 'in_progress',
        summary: LOADING_REPLY_SUMMARY,
        steps: [
          {
            stepId: 'pending-step',
            title: '理解目标',
            status: 'in_progress',
            summary: '正在分析你的目标并准备执行计划。',
            updatedAt: new Date().toISOString()
          }
        ],
        updatedAt: new Date().toISOString()
      },
      messages: []
    }

    activeSession.value = {
      ...optimisticSession,
      messages: [
        ...optimisticSession.messages,
        {
          messageId: `local-${Date.now()}`,
          role: 'user',
          content: message,
          createdAt: new Date().toISOString(),
          model: '',
          usage: {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null
          }
        }
      ]
    }

    draft.value = ''
    chatError.value = ''
    isSending.value = true

    try {
      const data = await http.post('/api/agent/chat', {
        sessionId: activeSessionId.value,
        message,
        aiId: selectedAiId.value,
        model: selectedModel.value
      })

      if (!data.session?.sessionId) {
        throw new Error('Agent chat returned an invalid session payload.')
      }

      activeSession.value = data.session
      activeSessionId.value = data.session.sessionId
      persistActiveSessionId()
      upsertSessionSummary(data.session)
    } catch (error) {
      activeSession.value = previousActiveSession
      draft.value = message
      chatError.value = normalizeErrorMessage(error, '发送消息失败。')
    } finally {
      isSending.value = false
    }
  }

  async function openWorkspaceFile(filePath) {
    const normalizedPath = String(filePath || '').trim()

    if (!activeSessionId.value || !normalizedPath) {
      return
    }

    selectedWorkspaceFilePath.value = normalizedPath
    selectedWorkspaceFileContent.value = ''
    selectedWorkspaceFileUpdatedAt.value = ''
    selectedWorkspaceFileSizeBytes.value = null
    workspaceFileError.value = ''
    isLoadingWorkspaceFile.value = true

    try {
      const data = await http.get(`/api/agent/sessions/${activeSessionId.value}/file-content`, {
        params: {
          path: normalizedPath
        }
      })

      const item = data.item || {}
      selectedWorkspaceFileContent.value = String(item.content || '')
      selectedWorkspaceFileUpdatedAt.value = String(item.updatedAt || '')
      selectedWorkspaceFileSizeBytes.value = Number.isFinite(item.sizeBytes) ? item.sizeBytes : null
    } catch (error) {
      workspaceFileError.value = normalizeErrorMessage(error, '读取会话文件失败。')
    } finally {
      isLoadingWorkspaceFile.value = false
    }
  }

  function closeWorkspaceFile() {
    resetWorkspaceFilePreview()
  }

  async function refreshActiveSession() {
    if (!activeSessionId.value) {
      return
    }

    await loadSessionDetail(activeSessionId.value, {
      silent: true,
      preserveChatError: true,
      asBackgroundRefresh: true
    })
  }

  async function cancelActiveTask() {
    if (!activeSessionId.value || !isAgentRunning.value || isCancellingTask.value) {
      return
    }

    isCancellingTask.value = true
    chatError.value = ''

    try {
      const data = await http.post(`/api/agent/sessions/${activeSessionId.value}/cancel`)

      if (data.item) {
        activeSession.value = data.item
        upsertSessionSummary(data.item)
      }

      await refreshActiveSession()
    } catch (error) {
      chatError.value = normalizeErrorMessage(error, '停止当前处理失败。')
    } finally {
      isCancellingTask.value = false
    }
  }

  async function refreshWorkspace() {
    await Promise.all([
      loadAiConfigs(),
      loadSessions()
    ])

    if (activeSessionId.value) {
      await loadSessionDetail(activeSessionId.value, { silent: true })
      return
    }

    if (!sessions.value.length) {
      activeSession.value = {
        sessionId: '',
        title: NEW_SESSION_TITLE,
        messages: [],
        task: {
          taskId: '',
          title: NEW_SESSION_TITLE,
          status: 'idle',
          summary: WAITING_FOR_GOAL_SUMMARY,
          steps: [],
          updatedAt: new Date().toISOString()
        }
      }
    }
  }

  watch(
    [activeSessionId, isAgentRunning],
    () => {
      scheduleTaskPolling()
    },
    { immediate: true }
  )

  watch(
    () => currentTask.value?.status,
    (nextStatus, previousStatus) => {
      if (previousStatus && nextStatus === 'completed' && previousStatus !== 'completed') {
        emitNotify({
          message: '代码处理已完成，请查看最新回复和会话文件。',
          type: 'success'
        })
      }
    }
  )

  onMounted(async () => {
    await refreshWorkspace()
  })

  onUnmounted(() => {
    stopTaskPolling()
  })

  return {
    activeMessages,
    activeSession,
    activeSessionId,
    aiConfigs,
    activeWorkspaceFiles,
    activeWorkspaceFolder,
    closeWorkspaceFile,
    canSend,
    chatError,
    isLoadingWorkspaceFile,
    createSession: createSessionEntry,
    currentTask,
    deleteSession,
    draft,
    isAgentRunning,
    openWorkspaceFile,
    selectedWorkspaceFileContent,
    selectedWorkspaceFilePath,
    selectedWorkspaceFileSizeBytes,
    selectedWorkspaceFileUpdatedAt,
    workspaceMode,
    workspaceFileError,
    isCancellingTask,
    isCreatingSession,
    isLoadingAiConfigs,
    isLoadingSession,
    isLoadingSessions,
    isRefreshingActiveSession,
    isSending,
    loadError,
    modelOptions,
    refreshActiveSession,
    refreshWorkspace,
    cancelActiveTask,
    selectSession,
    selectedAgentLabel,
    selectedAiId,
    selectedModel,
    selectedModelLabel,
    sendMessage,
    sessionError,
    sessions,
    setSelectedAiId,
    setSelectedModel
  }
}
