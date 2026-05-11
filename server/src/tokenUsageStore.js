import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createId, normalizeTrimmedString, nowIso } from './utils.js'

function normalizeTokenCount(value) {
  const normalizedValue = Number(value)
  return Number.isFinite(normalizedValue) && normalizedValue > 0 ? Math.round(normalizedValue) : 0
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  const inputTokens = normalizeTokenCount(usage.inputTokens)
  const outputTokens = normalizeTokenCount(usage.outputTokens)
  const totalTokens = normalizeTokenCount(usage.totalTokens) || inputTokens + outputTokens

  if (!totalTokens) {
    return null
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens
  }
}

function createRecord({ sessionId, message, aiId = '' }) {
  const usage = normalizeUsage(message?.usage)

  if (!usage) {
    return null
  }

  return {
    recordId: createId('usage'),
    messageId: normalizeTrimmedString(message?.messageId),
    sessionId: normalizeTrimmedString(sessionId),
    aiId: normalizeTrimmedString(aiId),
    model: normalizeTrimmedString(message?.model) || 'Unknown model',
    role: normalizeTrimmedString(message?.role) || 'assistant',
    type: 'ai',
    createdAt: normalizeTrimmedString(message?.createdAt) || nowIso(),
    recordedAt: nowIso(),
    ...usage
  }
}

function createEmbeddingRecord({
  aiId = '',
  model = '',
  usage = null,
  source = ''
} = {}) {
  const normalizedUsage = normalizeUsage(usage)

  if (!normalizedUsage) {
    return null
  }

  const timestamp = nowIso()

  return {
    recordId: createId('usage'),
    messageId: '',
    sessionId: '',
    aiId: normalizeTrimmedString(aiId),
    model: normalizeTrimmedString(model) || 'Unknown embedding model',
    role: 'embedding',
    type: 'embedding',
    source: normalizeTrimmedString(source),
    createdAt: timestamp,
    recordedAt: timestamp,
    ...normalizedUsage
  }
}

function createAiNameMap(aiConfigs = []) {
  return new Map(
    aiConfigs.map((item) => [
      normalizeTrimmedString(item.aiId),
      normalizeTrimmedString(item.name)
    ])
  )
}

export class TokenUsageStore {
  constructor(filePath) {
    this.filePath = normalizeTrimmedString(filePath)
    this.pendingWrite = Promise.resolve()
  }

  async ensure() {
    if (!this.filePath) {
      throw new Error('Token usage store file path is required.')
    }

    await mkdir(dirname(this.filePath), { recursive: true })
  }

  async readRecords() {
    try {
      const rawValue = await readFile(this.filePath, 'utf8')

      return rawValue
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return []
      }

      throw error
    }
  }

  async appendRecords(records) {
    const normalizedRecords = records.filter(Boolean)

    if (!normalizedRecords.length) {
      return
    }

    await this.ensure()

    this.pendingWrite = this.pendingWrite.then(() => appendFile(
      this.filePath,
      `${normalizedRecords.map((item) => JSON.stringify(item)).join('\n')}\n`,
      'utf8'
    ))

    await this.pendingWrite
  }

  async recordMessage({ sessionId, message, aiId = '' }) {
    const record = createRecord({ sessionId, message, aiId })

    if (!record) {
      return
    }

    await this.appendRecords([record])
  }

  async recordEmbeddingUsage({ aiId = '', model = '', usage = null, source = '' } = {}) {
    const record = createEmbeddingRecord({ aiId, model, usage, source })

    if (!record) {
      return
    }

    await this.appendRecords([record])
  }

  async backfillFromSessions(sessions = []) {
    const existingRecords = await this.readRecords()
    const existingMessageIds = new Set(
      existingRecords
        .map((item) => normalizeTrimmedString(item.messageId))
        .filter(Boolean)
    )
    const records = []

    for (const session of sessions) {
      const sessionId = normalizeTrimmedString(session?.sessionId)
      const aiId = normalizeTrimmedString(session?.lastAiId)
      const messages = Array.isArray(session?.messages) ? session.messages : []

      for (const message of messages) {
        const messageId = normalizeTrimmedString(message?.messageId)

        if (messageId && existingMessageIds.has(messageId)) {
          continue
        }

        const record = createRecord({
          sessionId,
          message: {
            ...message,
            model: normalizeTrimmedString(message?.model || session?.lastModel)
          },
          aiId
        })

        if (!record) {
          continue
        }

        records.push(record)

        if (record.messageId) {
          existingMessageIds.add(record.messageId)
        }
      }
    }

    await this.appendRecords(records)
    return records.length
  }

  async getAnalytics(aiConfigs = []) {
    const records = await this.readRecords()
    const aiNameById = createAiNameMap(aiConfigs)
    const rowsByKey = new Map()
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    let messageCount = 0

    for (const record of records) {
      const recordInputTokens = normalizeTokenCount(record?.inputTokens)
      const recordOutputTokens = normalizeTokenCount(record?.outputTokens)
      const recordTotalTokens = normalizeTokenCount(record?.totalTokens) || recordInputTokens + recordOutputTokens

      if (!recordTotalTokens) {
        continue
      }

      const aiId = normalizeTrimmedString(record?.aiId)
      const model = normalizeTrimmedString(record?.model) || 'Unknown model'
      const type = normalizeTrimmedString(record?.type) || (normalizeTrimmedString(record?.role) === 'embedding' ? 'embedding' : 'ai')
      const key = `${type}::${aiId || 'unknown'}::${model}`
      const currentRow = rowsByKey.get(key) || {
        key,
        type,
        aiId,
        aiName: aiNameById.get(aiId) || aiId || 'Unknown config',
        model,
        messageCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }

      currentRow.messageCount += 1
      currentRow.inputTokens += recordInputTokens
      currentRow.outputTokens += recordOutputTokens
      currentRow.totalTokens += recordTotalTokens
      rowsByKey.set(key, currentRow)

      messageCount += 1
      inputTokens += recordInputTokens
      outputTokens += recordOutputTokens
      totalTokens += recordTotalTokens
    }

    const items = [...rowsByKey.values()]
      .map((item) => ({
        ...item,
        usageRate: totalTokens ? item.totalTokens / totalTokens : 0
      }))
      .sort((left, right) => right.totalTokens - left.totalTokens)

    return {
      summary: {
        modelCount: items.length,
        messageCount,
        inputTokens,
        outputTokens,
        totalTokens
      },
      items
    }
  }
}

export function createTokenUsageStore(filePath) {
  return new TokenUsageStore(filePath)
}
