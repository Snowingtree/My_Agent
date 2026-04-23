import { computed, onMounted, ref } from 'vue'
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

  const activeMessages = computed(() => activeSession.value?.messages || [])
  const currentTask = computed(() => activeSession.value?.task || null)
  const selectedAiConfig = computed(
    () => aiConfigs.value.find((item) => item.aiId === selectedAiId.value) || null
  )
  const modelOptions = computed(() => selectedAiConfig.value?.versions || [])
  const selectedModelLabel = computed(() => selectedModel.value || UNSELECTED_MODEL_LABEL)
  const selectedAgentLabel = computed(() => selectedAiConfig.value?.label || UNSELECTED_AGENT_LABEL)
  const canSend = computed(() => Boolean(
    draft.value.trim()
    && !isSending.value
    && !isLoadingSession.value
  ))

  function persistActiveSessionId() {
    writeStorageValue(resolvedStorage, AGENT_ACTIVE_SESSION_KEY, activeSessionId.value)
  }

  function persistSelectedAi() {
    writeStorageValue(resolvedStorage, AGENT_AI_ID_KEY, selectedAiId.value)
    writeStorageValue(resolvedStorage, AGENT_AI_MODEL_KEY, selectedModel.value)
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

  async function loadSessionDetail(sessionId, { silent = false } = {}) {
    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId) {
      activeSession.value = null
      activeSessionId.value = ''
      persistActiveSessionId()
      return
    }

    if (!silent) {
      isLoadingSession.value = true
    }

    chatError.value = ''

    try {
      const data = await http.get(`/api/agent/sessions/${normalizedSessionId}`)
      activeSession.value = data.item || null
      activeSessionId.value = activeSession.value?.sessionId || normalizedSessionId
      persistActiveSessionId()

      if (activeSession.value) {
        upsertSessionSummary(activeSession.value)
      }
    } catch (error) {
      chatError.value = normalizeErrorMessage(error, '读取会话详情失败。')
    } finally {
      if (!silent) {
        isLoadingSession.value = false
      }
    }
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
          updatedAt: new Date().toISOString()
        }
      }
    }
  }

  onMounted(async () => {
    await refreshWorkspace()
  })

  return {
    activeMessages,
    activeSession,
    activeSessionId,
    aiConfigs,
    canSend,
    chatError,
    createSession: createSessionEntry,
    currentTask,
    deleteSession,
    draft,
    isCreatingSession,
    isLoadingAiConfigs,
    isLoadingSession,
    isLoadingSessions,
    isSending,
    loadError,
    modelOptions,
    refreshWorkspace,
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
