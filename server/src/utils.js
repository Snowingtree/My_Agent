import { randomUUID } from 'node:crypto'

export const DEFAULT_SESSION_TITLE = '新对话'
export const DEFAULT_TASK_SUMMARY = '等待你给出第一个目标，我会围绕当前会话持续推进。'
export const RUNNING_TASK_STATUSES = new Set(['queued', 'pending', 'running', 'in_progress'])

export function nowIso() {
  return new Date().toISOString()
}

export function createId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`
}

export function normalizeTrimmedString(value) {
  return String(value ?? '').trim()
}

export function cloneValue(value) {
  if (value == null) {
    return value
  }

  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item))
  }

  if (value instanceof Date) {
    return new Date(value.getTime())
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)])
    )
  }

  return value
}

export function truncateText(value, maxLength = 24) {
  const normalized = normalizeTrimmedString(value).replace(/\s+/g, ' ')

  if (!normalized) {
    return ''
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

export function createSessionTitle(seedText) {
  return truncateText(seedText, 24) || DEFAULT_SESSION_TITLE
}

export function parseList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => normalizeTrimmedString(item)).filter(Boolean))]
  }

  return [...new Set(
    normalizeTrimmedString(value)
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )]
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function getRecentMessages(messages, limit = 12) {
  if (!Array.isArray(messages)) {
    return []
  }

  return messages.slice(-Math.max(1, limit))
}

export function isRunningTaskStatus(status) {
  return RUNNING_TASK_STATUSES.has(normalizeTrimmedString(status).toLowerCase())
}

export function createTaskStep({
  title,
  status = 'pending',
  summary = '',
  startedAt = null,
  completedAt = null
} = {}) {
  const updatedAt = nowIso()

  return {
    stepId: createId('step'),
    title: normalizeTrimmedString(title) || '未命名步骤',
    status: normalizeTrimmedString(status).toLowerCase() || 'pending',
    summary: normalizeTrimmedString(summary),
    startedAt,
    completedAt,
    updatedAt
  }
}

export function createEmptyTask(title = DEFAULT_SESSION_TITLE) {
  const updatedAt = nowIso()

  return {
    taskId: '',
    title,
    status: 'idle',
    summary: DEFAULT_TASK_SUMMARY,
    steps: [],
    startedAt: null,
    completedAt: null,
    updatedAt
  }
}

export function createMessage({
  role,
  content,
  model = '',
  usage = {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null
  }
} = {}) {
  return {
    messageId: createId('msg'),
    role: normalizeTrimmedString(role) || 'assistant',
    content: String(content ?? ''),
    createdAt: nowIso(),
    model: normalizeTrimmedString(model),
    usage
  }
}

export function createSessionRecord() {
  const timestamp = nowIso()
  const sessionId = createId('session')

  return {
    sessionId,
    title: DEFAULT_SESSION_TITLE,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    lastAiId: '',
    lastModel: '',
    lastSkillId: '',
    lastSkillIds: [],
    memorySummary: '',
    memoryUpdatedAt: null,
    memoryMessageCount: 0,
    memoryCompressedThroughMessageId: '',
    workspaceFolder: `sessions/${sessionId}`,
    workspaceFiles: [],
    messages: [],
    task: createEmptyTask(DEFAULT_SESSION_TITLE)
  }
}

export function sortSessionsByUpdatedAt(items) {
  return [...items].sort((left, right) => (
    String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || ''))
  ))
}
