import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import http, { buildApiUrl } from './http.js'
import {
  AGENT_ACTIVE_SESSION_KEY,
  AGENT_AI_ID_KEY,
  AGENT_AI_MODEL_KEY,
  AGENT_EMBEDDING_AI_ID_KEY,
  AGENT_EPHEMERAL_ATTACHMENT_MARKERS_KEY,
  AGENT_LARK_CHAT_ID_KEY,
  AGENT_MCP_SERVER_IDS_KEY,
  AGENT_RAG_COLLECTION_ID_KEY,
  AGENT_RAG_COLLECTION_IDS_KEY,
  AGENT_SKILL_ID_KEY,
  AUTH_TOKEN_KEY
} from './storage.js'

const NEW_SESSION_TITLE = '新对话'
const UNSELECTED_MODEL_LABEL = '未选择模型'
const UNSELECTED_AGENT_LABEL = '未选择模型配置'
const UNSELECTED_SKILL_LABEL = '自动选择'
const LOADING_REPLY_SUMMARY = '正在生成首轮回复...'
const WAITING_FOR_GOAL_SUMMARY = '等待你给出第一个目标，我会围绕当前会话持续推进。'
const AI_CONFIG_REQUEST_TIMEOUT = 10000
const LARK_CHAT_REQUEST_TIMEOUT = 15000
const TASK_POLL_INTERVAL_MS = 2500
const DRAFT_ATTACHMENT_BUCKET_KEY = '__draft__'
const MCP_DISABLED_SELECTION = '__mcp_disabled__'
const MCP_ALL_SELECTION = '__mcp_all__'
const MAX_EPHEMERAL_ATTACHMENT_COUNT = 12
const MAX_EPHEMERAL_ATTACHMENT_SIZE_BYTES = 2 * 1024 * 1024
const MAX_EPHEMERAL_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024
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

function readStorageStringArray(storage, storageKey) {
  if (!storage) {
    return []
  }

  const rawValue = String(storage.getItem(storageKey) || '').trim()

  if (!rawValue) {
    return []
  }

  try {
    const parsed = JSON.parse(rawValue)

    if (!Array.isArray(parsed)) {
      return []
    }

    return [...new Set(
      parsed
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )]
  } catch {
    return [...new Set(
      rawValue
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )]
  }
}

function writeStorageStringArray(storage, storageKey, value) {
  if (!storage) {
    return
  }

  const normalized = Array.isArray(value)
    ? [...new Set(
      value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )]
    : []

  if (!normalized.length) {
    storage.removeItem(storageKey)
    return
  }

  storage.setItem(storageKey, JSON.stringify(normalized))
}

function readAttachmentMarkers(storage) {
  if (!storage) {
    return {}
  }

  const rawValue = String(storage.getItem(AGENT_EPHEMERAL_ATTACHMENT_MARKERS_KEY) || '').trim()

  if (!rawValue) {
    return {}
  }

  try {
    const parsed = JSON.parse(rawValue)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeAttachmentMarkers(storage, value) {
  if (!storage) {
    return
  }

  const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const sessionIds = Object.keys(normalized)

  if (!sessionIds.length) {
    storage.removeItem(AGENT_EPHEMERAL_ATTACHMENT_MARKERS_KEY)
    return
  }

  storage.setItem(AGENT_EPHEMERAL_ATTACHMENT_MARKERS_KEY, JSON.stringify(normalized))
}

function getAttachmentBucketKey(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim()
  return normalizedSessionId || DRAFT_ATTACHMENT_BUCKET_KEY
}

function formatAttachmentSize(sizeBytes) {
  const normalizedSize = Number(sizeBytes)

  if (!Number.isFinite(normalizedSize) || normalizedSize < 0) {
    return ''
  }

  if (normalizedSize >= 1024 * 1024) {
    return `${(normalizedSize / (1024 * 1024)).toFixed(1)} MB`
  }

  if (normalizedSize >= 1024) {
    return `${(normalizedSize / 1024).toFixed(1)} KB`
  }

  return `${normalizedSize} B`
}

function createAttachmentMetaList(value) {
  return Array.isArray(value)
    ? value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    : []
}

function getFriendlyErrorMessage(errorMessage, fallbackMessage) {
  const normalized = String(errorMessage || '').trim()

  if (!normalized) {
    return fallbackMessage
  }

  const lowerMessage = normalized.toLowerCase()

  if (lowerMessage.includes('matched') && lowerMessage.includes('snippets')) {
    const matchCount = normalized.match(/(\d+)\s+snippets/) ? normalized.match(/(\d+)\s+snippets/)[1] : '多个'
    return `助手在文件中找到了 ${matchCount} 个相同的内容，不确定要修改哪一个。请提供更多上下文，或者让助手使用“全部替换”的方式修改。`
  }

  if (lowerMessage.includes('no match found') || lowerMessage.includes('did not match')) {
    return `助手没有在文件中找到要修改的内容，可能文件已经变化。请让助手重新检查文件内容后再修改。`
  }

  if (lowerMessage.includes('file not found') || lowerMessage.includes('no such file')) {
    return '助手找不到指定的文件，请确认文件路径是否正确。'
  }

  if (lowerMessage.includes('permission denied') || lowerMessage.includes('access denied')) {
    return '助手没有权限执行该操作。'
  }

  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return `操作超时，可能是任务太复杂或网络不稳定。请稍后再试。`
  }

  if (lowerMessage.includes('final action without a reply') || lowerMessage.includes('without a reply')) {
    return '助手执行了操作但没有给出说明。这通常是模型响应不完整导致的，建议重新发起请求，并要求明确说明修改结果。'
  }

  if (lowerMessage.includes('model returned') && lowerMessage.includes('final')) {
    return `AI 模型返回了不完整的响应。建议重新尝试该任务。`
  }

  if (
    lowerMessage.includes('html 错误页')
    || (
      lowerMessage.includes('<html')
      && (
        lowerMessage.includes('404 not found')
        || lowerMessage.includes('openresty')
      )
    )
  ) {
    return 'AI 接口返回了 HTML 错误页，通常表示当前模型配置的 AI Base URL 不正确。请检查模型配置中的接口地址。'
  }

  return normalized
}

function normalizeErrorMessage(error, fallbackMessage) {
  const rawMessage = error instanceof Error ? error.message : String(error || '')
  return getFriendlyErrorMessage(rawMessage, fallbackMessage)
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

function normalizeLarkChatOption(item) {
  const chatId = String(item?.chatId || item?.chat_id || '').trim()

  if (!chatId) {
    return null
  }

  return {
    chatId,
    name: String(item?.name || item?.chatName || chatId).trim() || chatId,
    description: String(item?.description || '').trim()
  }
}

function normalizeMcpServerOption(item) {
  const serverId = String(item?.serverId || '').trim()

  if (!serverId) {
    return null
  }

  return {
    serverId,
    name: String(item?.name || serverId).trim() || serverId,
    enabled: Boolean(item?.enabled),
    status: String(item?.status || '').trim(),
    error: String(item?.error || '').trim(),
    toolNamePrefix: String(item?.toolNamePrefix || '').trim(),
    toolCount: Number(item?.toolCount || 0)
  }
}

function normalizeContextMemoryConfig(item) {
  const thresholdTurns = Number(item?.thresholdTurns ?? item?.thresholdMessages)
  const keepTurns = Number(item?.keepTurns ?? item?.keepMessages)
  const minBatchTurns = Number(item?.minBatchTurns ?? item?.minBatchMessages)
  const maxSummaryChars = Number(item?.maxSummaryChars)
  const normalizedThresholdTurns = Number.isFinite(thresholdTurns) && thresholdTurns > 0 ? thresholdTurns : 20
  const normalizedKeepTurns = Number.isFinite(keepTurns) && keepTurns > 0 ? keepTurns : 10
  const normalizedMinBatchTurns = Number.isFinite(minBatchTurns) && minBatchTurns > 0 ? minBatchTurns : 4

  return {
    enabled: item?.enabled !== false,
    countUnit: String(item?.countUnit || 'turn').trim() || 'turn',
    thresholdTurns: normalizedThresholdTurns,
    keepTurns: normalizedKeepTurns,
    minBatchTurns: normalizedMinBatchTurns,
    thresholdMessages: normalizedThresholdTurns,
    keepMessages: normalizedKeepTurns,
    minBatchMessages: normalizedMinBatchTurns,
    maxSummaryChars: Number.isFinite(maxSummaryChars) && maxSummaryChars > 0 ? maxSummaryChars : 6000
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
  const embeddingConfigs = ref([])
  const skills = ref([])
  const isLoadingAiConfigs = ref(false)
  const isLoadingSkills = ref(false)
  const selectedAiId = ref(readStorageValue(resolvedStorage, AGENT_AI_ID_KEY))
  const selectedModel = ref(readStorageValue(resolvedStorage, AGENT_AI_MODEL_KEY))
  const selectedSkillIds = ref(readStorageStringArray(resolvedStorage, AGENT_SKILL_ID_KEY))
  const storedMcpServerIds = readStorageStringArray(resolvedStorage, AGENT_MCP_SERVER_IDS_KEY)
  const selectedMcpServerIds = ref(storedMcpServerIds.length ? storedMcpServerIds : [MCP_DISABLED_SELECTION])
  const selectedLarkChatId = ref(readStorageValue(resolvedStorage, AGENT_LARK_CHAT_ID_KEY))
  const legacySelectedRagCollectionId = readStorageValue(resolvedStorage, AGENT_RAG_COLLECTION_ID_KEY)
  const selectedRagCollectionIds = ref(readStorageStringArray(resolvedStorage, AGENT_RAG_COLLECTION_IDS_KEY))
  if (!selectedRagCollectionIds.value.length && legacySelectedRagCollectionId) {
    selectedRagCollectionIds.value = [legacySelectedRagCollectionId]
  }
  const selectedEmbeddingAiId = ref(readStorageValue(resolvedStorage, AGENT_EMBEDDING_AI_ID_KEY))
  const ragCollections = ref([])
  const isLoadingRagCollections = ref(false)
  const ragCollectionError = ref('')
  const larkChats = ref([])
  const mcpServers = ref([])
  const contextMemoryConfig = ref(normalizeContextMemoryConfig({}))
  const mcpServerError = ref('')
  const larkChatError = ref('')
  const isLoadingLarkChats = ref(false)
  const isLoadingMcpServers = ref(false)
  const isRefreshingActiveSession = ref(false)
  const isCancellingTask = ref(false)
  const isSessionStreamConnected = ref(false)
  const taskProgressMessage = ref(null)
  const currentToolMessage = ref(null)
  const partialAssistantReply = ref(null)
  const sessionAttachments = ref({})
  const expiredAttachmentNotice = ref(null)
  const selectedWorkspaceFilePath = ref('')
  const selectedWorkspaceFileContent = ref('')
  const selectedWorkspaceFileUpdatedAt = ref('')
  const selectedWorkspaceFileSizeBytes = ref(null)
  const isLoadingWorkspaceFile = ref(false)
  const workspaceFileError = ref('')

  const activeMessages = computed(() => {
    const persistedMessages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : []
    const transientMessages = [
      ...(taskProgressMessage.value ? [taskProgressMessage.value] : []),
      ...(currentToolMessage.value ? [currentToolMessage.value] : []),
      ...(partialAssistantReply.value ? [partialAssistantReply.value] : [])
    ]

    return transientMessages.length
      ? [...persistedMessages, ...transientMessages]
      : persistedMessages
  })
  const currentTask = computed(() => activeSession.value?.task || null)
  const activeWorkspaceFolder = computed(() => String(activeSession.value?.workspaceFolder || '').trim())
  const activeWorkspaceFiles = computed(() => (
    Array.isArray(activeSession.value?.workspaceFiles) ? activeSession.value.workspaceFiles : []
  ))
  const activeAttachmentBucketKey = computed(() => getAttachmentBucketKey(activeSessionId.value))
  const activeEphemeralAttachments = computed(() => (
    Array.isArray(sessionAttachments.value[activeAttachmentBucketKey.value])
      ? sessionAttachments.value[activeAttachmentBucketKey.value]
      : []
  ))
  const isAgentRunning = computed(() => isTaskRunning(currentTask.value))
  const activeSkillIds = computed(() => {
    const explicitSkillIds = Array.isArray(activeSession.value?.lastSkillIds)
      ? activeSession.value.lastSkillIds
      : []

    if (explicitSkillIds.length) {
      return [...new Set(
        explicitSkillIds
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )]
    }

    const fallbackSkillId = String(activeSession.value?.lastSkillId || '').trim()
    return fallbackSkillId ? [fallbackSkillId] : []
  })
  const selectedAiConfig = computed(
    () => aiConfigs.value.find((item) => item.aiId === selectedAiId.value) || null
  )
  const selectedSkills = computed(() => (
    skills.value.filter((item) => selectedSkillIds.value.includes(item.skillId))
  ))
  const modelOptions = computed(() => selectedAiConfig.value?.versions || [])
  const selectedModelLabel = computed(() => selectedModel.value || UNSELECTED_MODEL_LABEL)
  const selectedAgentLabel = computed(() => selectedAiConfig.value?.label || UNSELECTED_AGENT_LABEL)
  const selectedSkillLabel = computed(() => {
    if (!selectedSkills.value.length) {
      return UNSELECTED_SKILL_LABEL
    }

    if (selectedSkills.value.length === 1) {
      return selectedSkills.value[0].name
    }

    return `已选择 ${selectedSkills.value.length} 个技能`
  })
  const selectedLarkChat = computed(() => {
    const chatId = String(selectedLarkChatId.value || '').trim()

    if (!chatId) {
      return null
    }

    return larkChats.value.find((item) => item.chatId === chatId) || {
      chatId,
      name: chatId,
      description: ''
    }
  })
  const selectedLarkChatLabel = computed(() => selectedLarkChat.value?.name || '未设置默认群聊')
  const isMcpDisabled = computed(() => selectedMcpServerIds.value.includes(MCP_DISABLED_SELECTION))
  const isAllMcpSelected = computed(() => selectedMcpServerIds.value.includes(MCP_ALL_SELECTION))
  const selectedConcreteMcpServerIds = computed(() => (
    selectedMcpServerIds.value.filter((serverId) => (
      serverId !== MCP_DISABLED_SELECTION && serverId !== MCP_ALL_SELECTION
    ))
  ))
  const selectedMcpServers = computed(() => (
    mcpServers.value.filter((item) => selectedConcreteMcpServerIds.value.includes(item.serverId))
  ))
  const selectedMcpServerLabel = computed(() => {
    if (isMcpDisabled.value) {
      return '不使用 MCP'
    }

    if (isAllMcpSelected.value || !selectedConcreteMcpServerIds.value.length) {
      return '使用全部可用 MCP'
    }

    if (selectedMcpServers.value.length === 1) {
      return selectedMcpServers.value[0].name
    }

    return `已选择 ${selectedConcreteMcpServerIds.value.length} 个 MCP`
  })
  const selectedRagCollectionId = computed(() => selectedRagCollectionIds.value[0] || '')
  const selectedRagCollections = computed(() => (
    selectedRagCollectionIds.value.map((collectionId) => (
      ragCollections.value.find((item) => item.collectionId === collectionId) || {
        collectionId,
        name: '已选择知识库',
        description: '',
        documentCount: 0,
        chunkCount: 0
      }
    ))
  ))
  const selectedRagCollectionLabel = computed(() => {
    if (!selectedRagCollectionIds.value.length) {
      return '不使用知识库'
    }

    if (selectedRagCollections.value.length === 1) {
      return selectedRagCollections.value[0].name
    }

    return `已选择 ${selectedRagCollectionIds.value.length} 个知识库`
  })
  const hasDraftCodingIntent = computed(() => detectCodingIntent(draft.value))
  const workspaceMode = computed(() => {
    if (activeSkillIds.value.includes('coding_agent')) {
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
  let sessionDetailAbortController = null
  let sessionStreamStartTimer = null
  let sessionStreamAbortController = null

  function persistActiveSessionId() {
    writeStorageValue(resolvedStorage, AGENT_ACTIVE_SESSION_KEY, activeSessionId.value)
  }

  function persistSelectedAi() {
    writeStorageValue(resolvedStorage, AGENT_AI_ID_KEY, selectedAiId.value)
    writeStorageValue(resolvedStorage, AGENT_AI_MODEL_KEY, selectedModel.value)
  }

  function persistSelectedSkill() {
    writeStorageStringArray(resolvedStorage, AGENT_SKILL_ID_KEY, selectedSkillIds.value)
  }

  function persistSelectedMcpServers() {
    writeStorageStringArray(resolvedStorage, AGENT_MCP_SERVER_IDS_KEY, selectedMcpServerIds.value)
  }

  function persistSelectedLarkChat() {
    writeStorageValue(resolvedStorage, AGENT_LARK_CHAT_ID_KEY, selectedLarkChatId.value)
  }

  function persistSelectedRagCollection() {
    writeStorageStringArray(resolvedStorage, AGENT_RAG_COLLECTION_IDS_KEY, selectedRagCollectionIds.value)
    writeStorageValue(resolvedStorage, AGENT_RAG_COLLECTION_ID_KEY, selectedRagCollectionIds.value[0] || '')
  }

  function persistSelectedEmbeddingAi() {
    writeStorageValue(resolvedStorage, AGENT_EMBEDDING_AI_ID_KEY, selectedEmbeddingAiId.value)
  }

  function getAttachmentMarkerSnapshot() {
    return readAttachmentMarkers(resolvedStorage)
  }

  function persistAttachmentMarkerSnapshot(value) {
    writeAttachmentMarkers(resolvedStorage, value)
  }

  function setAttachmentMarker(sessionId, attachments) {
    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId) {
      return
    }

    const normalizedAttachments = Array.isArray(attachments)
      ? attachments.filter(Boolean)
      : []

    const nextMarkers = getAttachmentMarkerSnapshot()

    if (!normalizedAttachments.length) {
      delete nextMarkers[normalizedSessionId]
      persistAttachmentMarkerSnapshot(nextMarkers)
      return
    }

    nextMarkers[normalizedSessionId] = {
      names: normalizedAttachments.map((item) => item.name),
      updatedAt: new Date().toISOString()
    }
    persistAttachmentMarkerSnapshot(nextMarkers)
  }

  function clearAttachmentMarker(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId) {
      return
    }

    const nextMarkers = getAttachmentMarkerSnapshot()

    if (!(normalizedSessionId in nextMarkers)) {
      return
    }

    delete nextMarkers[normalizedSessionId]
    persistAttachmentMarkerSnapshot(nextMarkers)
  }

  function updateAttachmentBucket(bucketKey, attachments) {
    const normalizedBucketKey = getAttachmentBucketKey(bucketKey)
    const normalizedAttachments = Array.isArray(attachments) ? attachments : []

    if (!normalizedAttachments.length) {
      const nextBuckets = { ...sessionAttachments.value }
      delete nextBuckets[normalizedBucketKey]
      sessionAttachments.value = nextBuckets

      if (normalizedBucketKey !== DRAFT_ATTACHMENT_BUCKET_KEY) {
        clearAttachmentMarker(normalizedBucketKey)
      }
      return
    }

    sessionAttachments.value = {
      ...sessionAttachments.value,
      [normalizedBucketKey]: normalizedAttachments
    }

    if (normalizedBucketKey !== DRAFT_ATTACHMENT_BUCKET_KEY) {
      setAttachmentMarker(normalizedBucketKey, normalizedAttachments)
    }
  }

  function moveAttachmentBucket(fromSessionId, toSessionId) {
    const fromBucketKey = getAttachmentBucketKey(fromSessionId)
    const toBucketKey = getAttachmentBucketKey(toSessionId)

    if (fromBucketKey === toBucketKey) {
      return
    }

    const existingAttachments = Array.isArray(sessionAttachments.value[fromBucketKey])
      ? sessionAttachments.value[fromBucketKey]
      : []

    if (!existingAttachments.length) {
      return
    }

    const nextBuckets = { ...sessionAttachments.value }
    delete nextBuckets[fromBucketKey]
    nextBuckets[toBucketKey] = existingAttachments
    sessionAttachments.value = nextBuckets

    if (fromBucketKey !== DRAFT_ATTACHMENT_BUCKET_KEY) {
      clearAttachmentMarker(fromBucketKey)
    }

    if (toBucketKey !== DRAFT_ATTACHMENT_BUCKET_KEY) {
      setAttachmentMarker(toBucketKey, existingAttachments)
    }
  }

  function maybeShowExpiredAttachmentNotice(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId) {
      expiredAttachmentNotice.value = null
      return
    }

    const activeAttachments = Array.isArray(sessionAttachments.value[getAttachmentBucketKey(normalizedSessionId)])
      ? sessionAttachments.value[getAttachmentBucketKey(normalizedSessionId)]
      : []

    if (activeAttachments.length) {
      expiredAttachmentNotice.value = null
      clearAttachmentMarker(normalizedSessionId)
      return
    }

    const marker = getAttachmentMarkerSnapshot()[normalizedSessionId]

    if (!marker) {
      expiredAttachmentNotice.value = null
      return
    }

    expiredAttachmentNotice.value = {
      sessionId: normalizedSessionId,
      names: createAttachmentMetaList(marker.names)
    }
  }

  function dismissExpiredAttachmentNotice() {
    const sessionId = String(expiredAttachmentNotice.value?.sessionId || '').trim()

    if (sessionId) {
      clearAttachmentMarker(sessionId)
    }

    expiredAttachmentNotice.value = null
  }

  function stopTaskPolling() {
    if (typeof window === 'undefined' || taskPollTimer === null) {
      return
    }

    window.clearTimeout(taskPollTimer)
    taskPollTimer = null
  }

  function stopSessionDetailRequest() {
    if (sessionDetailAbortController) {
      sessionDetailAbortController.abort()
      sessionDetailAbortController = null
    }
  }

  function stopSessionStream() {
    if (typeof window !== 'undefined' && sessionStreamStartTimer !== null) {
      window.clearTimeout(sessionStreamStartTimer)
      sessionStreamStartTimer = null
    }

    if (sessionStreamAbortController) {
      sessionStreamAbortController.abort()
      sessionStreamAbortController = null
    }

    isSessionStreamConnected.value = false
  }

  function scheduleSessionStream(sessionId) {
    stopSessionStream()

    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId || typeof window === 'undefined') {
      return
    }

    sessionStreamStartTimer = window.setTimeout(() => {
      sessionStreamStartTimer = null
      void startSessionStream(normalizedSessionId)
    }, 180)
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

  async function decodeEphemeralAttachment(file) {
    if (!(file instanceof File)) {
      throw new Error('无效的上传文件。')
    }

    if (file.size > MAX_EPHEMERAL_ATTACHMENT_SIZE_BYTES) {
      throw new Error(`文件 ${file.name} 超过 ${formatAttachmentSize(MAX_EPHEMERAL_ATTACHMENT_SIZE_BYTES)}，请缩小后再上传。`)
    }

    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    if (bytes.includes(0)) {
      throw new Error(`文件 ${file.name} 看起来是二进制文件，当前只支持文本类文件。`)
    }

    const decoder = new TextDecoder('utf-8')
    const content = decoder.decode(bytes).replace(/^\uFEFF/, '')

    return {
      attachmentId: createId('upload'),
      name: String(file.name || 'untitled').trim() || 'untitled',
      type: String(file.type || '').trim(),
      sizeBytes: Number(file.size) || 0,
      content
    }
  }

  async function addEphemeralAttachments(files) {
    const fileList = Array.isArray(files) ? files.filter(Boolean) : []

    if (!fileList.length) {
      return
    }

    try {
      const bucketKey = activeAttachmentBucketKey.value
      const existingAttachments = Array.isArray(sessionAttachments.value[bucketKey])
        ? sessionAttachments.value[bucketKey]
        : []

      if (existingAttachments.length + fileList.length > MAX_EPHEMERAL_ATTACHMENT_COUNT) {
        emitNotify({
          message: `当前对话最多保留 ${MAX_EPHEMERAL_ATTACHMENT_COUNT} 个临时文件。`,
          type: 'danger'
        })
        return
      }

      const decodedAttachments = []
      let totalBytes = existingAttachments.reduce((sum, item) => sum + Number(item?.sizeBytes || 0), 0)

      for (const file of fileList) {
        const nextAttachment = await decodeEphemeralAttachment(file)

        if (totalBytes + nextAttachment.sizeBytes > MAX_EPHEMERAL_ATTACHMENT_TOTAL_BYTES) {
          throw new Error(`临时文件总大小不能超过 ${formatAttachmentSize(MAX_EPHEMERAL_ATTACHMENT_TOTAL_BYTES)}。`)
        }

        totalBytes += nextAttachment.sizeBytes
        decodedAttachments.push(nextAttachment)
      }

      updateAttachmentBucket(bucketKey, [...existingAttachments, ...decodedAttachments])

      if (activeSessionId.value) {
        maybeShowExpiredAttachmentNotice(activeSessionId.value)
      }
    } catch (error) {
      emitNotify({
        message: normalizeErrorMessage(error, '上传临时文件失败。'),
        type: 'danger'
      })
    }
  }

  function removeEphemeralAttachment(attachmentId) {
    const normalizedAttachmentId = String(attachmentId || '').trim()

    if (!normalizedAttachmentId) {
      return
    }

    const bucketKey = activeAttachmentBucketKey.value
    const existingAttachments = Array.isArray(sessionAttachments.value[bucketKey])
      ? sessionAttachments.value[bucketKey]
      : []
    const nextAttachments = existingAttachments.filter((item) => item.attachmentId !== normalizedAttachmentId)

    updateAttachmentBucket(bucketKey, nextAttachments)
  }

  function resetPartialAssistantReply() {
    partialAssistantReply.value = null
  }

  function resetCurrentToolMessage() {
    currentToolMessage.value = null
  }

  function resetTaskProgressMessage() {
    taskProgressMessage.value = null
  }

  function applyActiveSessionSnapshot(item) {
    activeSession.value = item || null
    activeSessionId.value = activeSession.value?.sessionId || activeSessionId.value
    persistActiveSessionId()

    if (!isTaskRunning(activeSession.value?.task)) {
      resetTaskProgressMessage()
      resetCurrentToolMessage()
    }

    if (
      selectedWorkspaceFilePath.value
      && !activeWorkspaceFiles.value.some((entry) => entry.path === selectedWorkspaceFilePath.value)
    ) {
      resetWorkspaceFilePreview()
      return
    }

    if (!selectedWorkspaceFilePath.value) {
      return
    }

    const activeFile = activeWorkspaceFiles.value.find((entry) => entry.path === selectedWorkspaceFilePath.value)
    const nextUpdatedAt = String(activeFile?.updatedAt || '').trim()
    const currentUpdatedAt = String(selectedWorkspaceFileUpdatedAt.value || '').trim()

    if (activeFile && nextUpdatedAt && nextUpdatedAt !== currentUpdatedAt) {
      void openWorkspaceFile(selectedWorkspaceFilePath.value)
    }
  }

  async function startSessionStream(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim()

    stopSessionStream()

    if (!normalizedSessionId || typeof window === 'undefined') {
      return
    }

    const token = localStorage.getItem(AUTH_TOKEN_KEY)

    if (!token) {
      return
    }

    const controller = new AbortController()
    sessionStreamAbortController = controller

    try {
      const response = await fetch(buildApiUrl(`/api/agent/sessions/${normalizedSessionId}/stream`), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`
        },
        signal: controller.signal
      })

      if (!response.ok || !response.body) {
        throw new Error(`Session stream failed with ${response.status}.`)
      }

      isSessionStreamConnected.value = true
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventName = 'message'
      let dataLines = []

      const flushEvent = () => {
        if (!dataLines.length) {
          eventName = 'message'
          return
        }

        const payloadText = dataLines.join('\n')
        eventName = eventName || 'message'
        dataLines = []

        try {
          const payload = payloadText ? JSON.parse(payloadText) : {}

          if (eventName === 'session.updated' && payload?.item) {
            applyActiveSessionSnapshot(payload.item)
            upsertSessionSummary(payload.item)
            return
          }

          if (eventName === 'task.progress') {
            taskProgressMessage.value = {
              messageId: `progress-${normalizedSessionId}`,
              role: 'assistant',
              content: String(payload?.summary || ''),
              createdAt: new Date().toISOString(),
              model: String(payload?.model || ''),
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null
              }
            }
            return
          }

          if (eventName === 'tool.started') {
            currentToolMessage.value = {
              messageId: `tool-progress-${String(payload?.executionId || normalizedSessionId)}`,
              role: 'tool',
              content: String(payload?.content || ''),
              createdAt: new Date().toISOString(),
              model: '',
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null
              }
            }
            return
          }

          if (eventName === 'tool.output') {
            const executionId = String(payload?.executionId || '').trim()

            if (!executionId) {
              return
            }

            const currentMessageId = `tool-progress-${executionId}`

            if (String(currentToolMessage.value?.messageId || '').trim() !== currentMessageId) {
              return
            }

            currentToolMessage.value = {
              ...(currentToolMessage.value || {}),
              messageId: currentMessageId,
              role: 'tool',
              content: String(payload?.content || currentToolMessage.value?.content || ''),
              createdAt: currentToolMessage.value?.createdAt || new Date().toISOString(),
              model: '',
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null
              }
            }
            return
          }

          if (eventName === 'tool.finished') {
            const finishedExecutionId = String(payload?.executionId || '').trim()
            const currentMessageId = String(currentToolMessage.value?.messageId || '').trim()

            if (!finishedExecutionId || currentMessageId === `tool-progress-${finishedExecutionId}`) {
              resetCurrentToolMessage()
            }
            return
          }

          if (eventName === 'assistant.partial') {
            resetTaskProgressMessage()
            resetCurrentToolMessage()
            partialAssistantReply.value = {
              messageId: `partial-${normalizedSessionId}`,
              role: 'assistant',
              content: String(payload?.content || ''),
              createdAt: new Date().toISOString(),
              model: String(payload?.model || ''),
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null
              }
            }
            return
          }

          if (eventName === 'assistant.finalized') {
            resetTaskProgressMessage()
            resetCurrentToolMessage()
            resetPartialAssistantReply()
            return
          }

          if (eventName === 'session.deleted' && payload?.sessionId === activeSessionId.value) {
            stopSessionStream()
            activeSession.value = null
            activeSessionId.value = ''
            persistActiveSessionId()
            resetWorkspaceFilePreview()
            resetTaskProgressMessage()
            resetCurrentToolMessage()
            resetPartialAssistantReply()
          }
        } catch {
          // ignore malformed stream payloads
        } finally {
          eventName = 'message'
        }
      }

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line) {
            flushEvent()
            continue
          }

          if (line.startsWith(':')) {
            continue
          }

          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || 'message'
            continue
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }
      }

      if (buffer.trim()) {
        const trailingLines = buffer.split(/\r?\n/)

        for (const line of trailingLines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || 'message'
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }

        flushEvent()
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      isSessionStreamConnected.value = false
    } finally {
      if (sessionStreamAbortController === controller) {
        sessionStreamAbortController = null
        isSessionStreamConnected.value = false
      }

      scheduleTaskPolling()
    }
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
      const [aiData, embeddingData] = await Promise.all([
        http.get('/api/ai/configs', {
          params: { type: 'ai' },
          timeout: AI_CONFIG_REQUEST_TIMEOUT
        }),
        http.get('/api/ai/configs', {
          params: { type: 'embedding' },
          timeout: AI_CONFIG_REQUEST_TIMEOUT
        })
      ])
      aiConfigs.value = Array.isArray(aiData.items)
        ? aiData.items.map((item) => normalizeAiConfigOption(item)).filter(Boolean)
        : []
      embeddingConfigs.value = Array.isArray(embeddingData.items)
        ? embeddingData.items.map((item) => normalizeAiConfigOption(item)).filter(Boolean)
        : []
      if (selectedEmbeddingAiId.value && !embeddingConfigs.value.some((item) => item.aiId === selectedEmbeddingAiId.value)) {
        selectedEmbeddingAiId.value = ''
        persistSelectedEmbeddingAi()
      }
      ensureSelectedModel()
    } catch (error) {
      aiConfigs.value = []
      embeddingConfigs.value = []
      loadError.value = normalizeErrorMessage(error, '读取 Agent 配置失败。')
    } finally {
      isLoadingAiConfigs.value = false
    }
  }

  async function loadSkills() {
    isLoadingSkills.value = true

    try {
      const data = await http.get('/api/agent/skills')
      skills.value = Array.isArray(data.items)
        ? data.items
          .map((item) => ({
            skillId: String(item?.skillId || '').trim(),
            name: String(item?.name || item?.skillId || '').trim(),
            description: String(item?.description || '').trim(),
            sourcePackage: String(item?.sourcePackage || '').trim(),
            sourceFile: String(item?.sourceFile || '').trim()
          }))
          .filter((item) => item.skillId)
        : []

      if (selectedSkillIds.value.length) {
        selectedSkillIds.value = selectedSkillIds.value.filter((skillId) => (
          skills.value.some((item) => item.skillId === skillId)
        ))
      }

      persistSelectedSkill()
    } catch {
      skills.value = []
    } finally {
      isLoadingSkills.value = false
    }
  }

  async function loadMcpServers() {
    isLoadingMcpServers.value = true
    mcpServerError.value = ''

    try {
      const data = await http.get('/api/agent/capabilities')
      mcpServers.value = Array.isArray(data?.mcpServers)
        ? data.mcpServers.map((item) => normalizeMcpServerOption(item)).filter(Boolean)
        : []
      contextMemoryConfig.value = normalizeContextMemoryConfig(data?.contextMemory)

      if (!isMcpDisabled.value && !isAllMcpSelected.value && selectedConcreteMcpServerIds.value.length) {
        selectedMcpServerIds.value = selectedConcreteMcpServerIds.value.filter((serverId) => (
          mcpServers.value.some((item) => item.serverId === serverId)
        ))
        if (!selectedMcpServerIds.value.length) {
          selectedMcpServerIds.value = [MCP_DISABLED_SELECTION]
        }
        persistSelectedMcpServers()
      }
    } catch (error) {
      mcpServers.value = []
      contextMemoryConfig.value = normalizeContextMemoryConfig({})
      mcpServerError.value = normalizeErrorMessage(error, '读取 MCP 服务失败。')
    } finally {
      isLoadingMcpServers.value = false
    }
  }

  async function loadLarkChats() {
    isLoadingLarkChats.value = true
    larkChatError.value = ''

    try {
      const query = activeSessionId.value
        ? `?sessionId=${encodeURIComponent(activeSessionId.value)}`
        : ''
      const data = await http.get(`/api/integrations/lark/chats${query}`, {
        timeout: LARK_CHAT_REQUEST_TIMEOUT
      })
      larkChats.value = Array.isArray(data.items)
        ? data.items.map((item) => normalizeLarkChatOption(item)).filter(Boolean)
        : []
    } catch (error) {
      larkChats.value = []
      larkChatError.value = normalizeErrorMessage(error, '读取飞书群聊列表失败。')
    } finally {
      isLoadingLarkChats.value = false
    }
  }

  async function loadRagCollections() {
    isLoadingRagCollections.value = true
    ragCollectionError.value = ''

    try {
      const data = await http.get('/api/agent/rag/collections')
      ragCollections.value = Array.isArray(data.items)
        ? data.items
          .map((item) => ({
            collectionId: String(item?.collectionId || '').trim(),
            name: String(item?.name || item?.collectionId || '').trim(),
            description: String(item?.description || '').trim(),
            documentCount: Number(item?.documentCount || 0),
            chunkCount: Number(item?.chunkCount || 0)
          }))
          .filter((item) => item.collectionId)
        : []

      // Do not clear the selected collection when the list is temporarily stale or empty.
      // The chat request can still use the persisted collection id.
    } catch (error) {
      ragCollections.value = []
      ragCollectionError.value = normalizeErrorMessage(error, '读取知识库列表失败。')
    } finally {
      isLoadingRagCollections.value = false
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
    stopSessionDetailRequest()
    const detailController = typeof AbortController !== 'undefined' ? new AbortController() : null
    sessionDetailAbortController = detailController

    if (!normalizedSessionId) {
      stopTaskPolling()
      stopSessionStream()
      stopSessionDetailRequest()
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
      const data = await http.get(`/api/agent/sessions/${normalizedSessionId}`, {
        signal: detailController?.signal
      })

      if (requestToken !== sessionLoadToken) {
        return
      }

      applyActiveSessionSnapshot(data.item || null)

      if (activeSession.value) {
        upsertSessionSummary(activeSession.value)
      }
    } catch (error) {
      if (detailController?.signal.aborted) {
        return
      }

      if (!preserveChatError || !chatError.value) {
        chatError.value = normalizeErrorMessage(error, '读取会话详情失败。')
      }
    } finally {
      if (sessionDetailAbortController === detailController) {
        sessionDetailAbortController = null
      }

      if (requestToken !== sessionLoadToken) {
        return
      }

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

    if (!activeSessionId.value || !isAgentRunning.value || isSessionStreamConnected.value) {
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

    const previousSessionId = String(activeSessionId.value || '').trim()
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
      moveAttachmentBucket(previousSessionId, item.sessionId)
      selectedMcpServerIds.value = [MCP_DISABLED_SELECTION]
      selectedRagCollectionIds.value = []
      persistSelectedMcpServers()
      persistSelectedRagCollection()
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
      updateAttachmentBucket(normalizedSessionId, [])
      clearAttachmentMarker(normalizedSessionId)

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

  function setSelectedSkillIds(nextSkillIds) {
    selectedSkillIds.value = Array.isArray(nextSkillIds)
      ? [...new Set(
        nextSkillIds
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )]
      : []
    persistSelectedSkill()
  }

  function setSelectedMcpServerIds(nextServerIds) {
    const normalizedServerIds = Array.isArray(nextServerIds)
      ? [...new Set(
        nextServerIds
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )]
      : []
    selectedMcpServerIds.value = normalizedServerIds.length
      ? normalizedServerIds
      : [MCP_DISABLED_SELECTION]
    persistSelectedMcpServers()
  }

  function setSelectedLarkChatId(nextChatId) {
    selectedLarkChatId.value = String(nextChatId || '').trim()
    persistSelectedLarkChat()
  }

  function setSelectedRagCollectionId(nextCollectionId) {
    const normalizedCollectionId = String(nextCollectionId || '').trim()
    selectedRagCollectionIds.value = normalizedCollectionId ? [normalizedCollectionId] : []
    persistSelectedRagCollection()
  }

  function setSelectedRagCollectionIds(nextCollectionIds) {
    selectedRagCollectionIds.value = Array.isArray(nextCollectionIds)
      ? [...new Set(
        nextCollectionIds
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )]
      : []
    persistSelectedRagCollection()
  }

  function setSelectedEmbeddingAiId(nextEmbeddingAiId) {
    selectedEmbeddingAiId.value = String(nextEmbeddingAiId || '').trim()
    persistSelectedEmbeddingAi()
  }

  function selectLarkChat(chat) {
    const normalizedChat = normalizeLarkChatOption(chat)

    if (!normalizedChat) {
      return
    }

    const existingIndex = larkChats.value.findIndex((item) => item.chatId === normalizedChat.chatId)

    if (existingIndex >= 0) {
      larkChats.value = larkChats.value.map((item, index) => (
        index === existingIndex ? { ...item, ...normalizedChat } : item
      ))
    } else {
      larkChats.value = [normalizedChat, ...larkChats.value]
    }

    selectedLarkChatId.value = normalizedChat.chatId
    persistSelectedLarkChat()

    emitNotify({
      type: 'success',
      message: `已选择飞书群聊：${normalizedChat.name}`
    })
  }

  function createSelectedLarkChatAttachment() {
    const chat = selectedLarkChat.value

    if (!chat?.chatId) {
      return null
    }

    const content = [
      'Selected Feishu/Lark group chat context for this Agent request.',
      'When the user asks to send a message to the group, use this exact target.',
      '',
      JSON.stringify({
        chatId: chat.chatId,
        name: chat.name,
        receiveIdType: 'chat_id',
        preferredToolHint: 'Use the Lark MCP message create tool with receive_id_type=chat_id.'
      }, null, 2)
    ].join('\n')

    return {
      name: 'selected-feishu-chat-context.json',
      type: 'application/json',
      sizeBytes: content.length,
      content
    }
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
    const previousSessionId = String(activeSessionId.value || '').trim()
    const attachmentBucketKey = getAttachmentBucketKey(previousSessionId)
    const conversationAttachments = Array.isArray(sessionAttachments.value[attachmentBucketKey])
      ? sessionAttachments.value[attachmentBucketKey]
      : []
    const selectedLarkChatAttachment = createSelectedLarkChatAttachment()

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
    resetTaskProgressMessage()
    resetCurrentToolMessage()
    resetPartialAssistantReply()

    try {
      const data = await http.post('/api/agent/chat', {
        sessionId: activeSessionId.value,
        message,
        aiId: selectedAiId.value,
        model: selectedModel.value,
        skillId: selectedSkillIds.value[0] || '',
        skillIds: selectedSkillIds.value,
        mcpServerIds: isMcpDisabled.value
          ? [MCP_DISABLED_SELECTION]
          : isAllMcpSelected.value
            ? [MCP_ALL_SELECTION]
            : selectedConcreteMcpServerIds.value,
        ragCollectionId: selectedRagCollectionIds.value[0] || '',
        ragCollectionIds: selectedRagCollectionIds.value,
        embeddingAiId: selectedEmbeddingAiId.value,
        attachments: [
          ...conversationAttachments.map((item) => ({
            name: item.name,
            type: item.type,
            sizeBytes: item.sizeBytes,
            content: item.content
          })),
          ...(selectedLarkChatAttachment ? [selectedLarkChatAttachment] : [])
        ]
      })

      if (!data.session?.sessionId) {
        throw new Error('Agent chat returned an invalid session payload.')
      }

      moveAttachmentBucket(previousSessionId, data.session.sessionId)
      applyActiveSessionSnapshot(data.session)
      upsertSessionSummary(data.session)
    } catch (error) {
      activeSession.value = previousActiveSession
      draft.value = message
      resetTaskProgressMessage()
      resetCurrentToolMessage()
      resetPartialAssistantReply()
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
      loadSkills(),
      loadMcpServers(),
      loadRagCollections(),
      loadSessions()
    ])

    if (activeSessionId.value) {
      await loadSessionDetail(activeSessionId.value, {
        silent: true
      })
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
    activeSessionId,
    (nextSessionId) => {
      resetPartialAssistantReply()
      resetTaskProgressMessage()
      resetCurrentToolMessage()
      maybeShowExpiredAttachmentNotice(nextSessionId)

      if (!nextSessionId) {
        stopSessionStream()
        return
      }

      scheduleSessionStream(nextSessionId)
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
    stopSessionDetailRequest()
    stopSessionStream()
    resetTaskProgressMessage()
    resetCurrentToolMessage()
    resetPartialAssistantReply()
  })

  return {
    activeEphemeralAttachments,
    activeMessages,
    activeSession,
    activeSessionId,
    contextMemoryConfig,
    aiConfigs,
    embeddingConfigs,
    addEphemeralAttachments,
    skills,
    activeWorkspaceFiles,
    activeWorkspaceFolder,
    closeWorkspaceFile,
    canSend,
    chatError,
    isLoadingWorkspaceFile,
    createSession: createSessionEntry,
    currentTask,
    deleteSession,
    dismissExpiredAttachmentNotice,
    draft,
    expiredAttachmentNotice,
    isAgentRunning,
    openWorkspaceFile,
    removeEphemeralAttachment,
    selectedWorkspaceFileContent,
    selectedWorkspaceFilePath,
    selectedWorkspaceFileSizeBytes,
    selectedWorkspaceFileUpdatedAt,
    workspaceMode,
    workspaceFileError,
    isCancellingTask,
    isCreatingSession,
    isLoadingAiConfigs,
    isLoadingSkills,
    isLoadingLarkChats,
    isLoadingMcpServers,
    isLoadingSession,
    isLoadingSessions,
    isRefreshingActiveSession,
    isSending,
    loadError,
    larkChatError,
    larkChats,
    mcpServerError,
    mcpServers,
    modelOptions,
    ragCollectionError,
    ragCollections,
    refreshActiveSession,
    refreshLarkChats: loadLarkChats,
    refreshMcpServers: loadMcpServers,
    refreshRagCollections: loadRagCollections,
    refreshWorkspace,
    cancelActiveTask,
    selectSession,
    selectLarkChat,
    selectedAgentLabel,
    selectedAiId,
    selectedModel,
    selectedModelLabel,
    selectedSkillIds,
    selectedSkillLabel,
    selectedMcpServerIds,
    selectedMcpServerLabel,
    selectedLarkChatId,
    selectedLarkChatLabel,
    selectedRagCollectionId,
    selectedRagCollectionIds,
    selectedRagCollectionLabel,
    selectedEmbeddingAiId,
    sendMessage,
    sessionError,
    sessions,
    setSelectedAiId,
    setSelectedLarkChatId,
    setSelectedMcpServerIds,
    setSelectedRagCollectionId,
    setSelectedRagCollectionIds,
    setSelectedEmbeddingAiId,
    setSelectedModel,
    setSelectedSkillIds
  }
}
