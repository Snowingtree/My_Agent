import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeTrimmedString, nowIso } from './utils.js'

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|password|secret|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer|cookie|credential)/i
const TOKEN_USAGE_KEY_PATTERN = /^(input|output|total|prompt|completion)?tokens?$/i
const DEFAULT_MAX_STRING_LENGTH = 1200
const DEFAULT_MAX_QUEUE_SIZE = 5000
const DEFAULT_BATCH_SIZE = 200
const DEFAULT_FLUSH_INTERVAL_MS = 1000

function toSafeFileName(value) {
  const normalized = normalizeTrimmedString(value)
  return (normalized || 'system').replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function truncateString(value, maxLength = DEFAULT_MAX_STRING_LENGTH) {
  const text = String(value ?? '')

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`
}

function createPreview(value, maxLength = 500) {
  return truncateString(value, maxLength).replace(/\s+/g, ' ').trim()
}

function isSensitiveKey(key) {
  const normalizedKey = String(key || '').trim()

  if (!normalizedKey) {
    return false
  }

  if (TOKEN_USAGE_KEY_PATTERN.test(normalizedKey)) {
    return false
  }

  if (/^token$/i.test(normalizedKey)) {
    return true
  }

  return SENSITIVE_KEY_PATTERN.test(normalizedKey)
}

function sanitizeValue(value, depth = 0) {
  if (value == null) {
    return value
  }

  if (typeof value === 'string') {
    return truncateString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (depth >= 8) {
    return '[max-depth]'
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key)
          ? '[redacted]'
          : sanitizeValue(item, depth + 1)
      ])
    )
  }

  return String(value)
}

function normalizeRecord(input = {}) {
  const sanitizedInput = sanitizeValue(input)
  const sessionId = normalizeTrimmedString(sanitizedInput?.sessionId)
  const event = normalizeTrimmedString(sanitizedInput?.event || sanitizedInput?.type) || 'event'

  return {
    ts: nowIso(),
    ...sanitizedInput,
    sessionId,
    event
  }
}

function sortValue(value) {
  if (value == null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item))
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortValue(value[key])])
  )
}

function canonicalizeRecord(record = {}) {
  const { hash, ...recordWithoutHash } = record
  return JSON.stringify(sortValue(recordWithoutHash))
}

function hashRecord(record = {}) {
  return createHash('sha256')
    .update(canonicalizeRecord(record))
    .digest('hex')
}

async function readLastAuditHash(filePath) {
  try {
    const content = await readFile(filePath, 'utf8')
    const lines = content.split(/\r?\n/).filter(Boolean)

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index])
        const hash = normalizeTrimmedString(parsed?.hash)

        if (hash) {
          return hash
        }
      } catch {
        // Ignore malformed legacy audit lines when bootstrapping the chain.
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  return ''
}

export class AuditLogger {
  constructor({
    auditDir,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    maxQueueSize = DEFAULT_MAX_QUEUE_SIZE
  } = {}) {
    this.auditDir = normalizeTrimmedString(auditDir)
    this.flushIntervalMs = Math.max(100, Number(flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS))
    this.batchSize = Math.max(1, Number(batchSize || DEFAULT_BATCH_SIZE))
    this.maxQueueSize = Math.max(this.batchSize, Number(maxQueueSize || DEFAULT_MAX_QUEUE_SIZE))
    this.queue = []
    this.flushing = false
    this.flushScheduled = false
    this.closed = false
    this.dropCount = 0
    this.lastHashes = new Map()

    this.timer = setInterval(() => {
      this.scheduleFlush()
    }, this.flushIntervalMs)
    this.timer.unref?.()
  }

  logEvent(event = {}) {
    if (this.closed || !this.auditDir) {
      return
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift()
      this.dropCount += 1
    }

    const record = normalizeRecord(event)

    if (this.dropCount > 0) {
      record.droppedBefore = this.dropCount
      this.dropCount = 0
    }

    this.queue.push(record)

    if (this.queue.length >= this.batchSize) {
      this.scheduleFlush()
    }
  }

  logUserMessage({ sessionId, content, ...rest } = {}) {
    this.logEvent({
      ...rest,
      sessionId,
      event: 'user_message',
      contentPreview: createPreview(content),
      contentLength: String(content ?? '').length
    })
  }

  scheduleFlush() {
    if (this.flushScheduled || this.flushing || !this.queue.length) {
      return
    }

    this.flushScheduled = true
    setImmediate(() => {
      this.flushScheduled = false
      this.flush().catch((error) => {
        console.warn('[audit] failed to flush audit events:', error instanceof Error ? error.message : error)
      })
    })
  }

  async flush() {
    if (this.flushing || !this.queue.length || !this.auditDir) {
      return
    }

    this.flushing = true
    const batch = this.queue.splice(0, this.batchSize)

    try {
      await mkdir(this.auditDir, { recursive: true })
      const groupedLines = new Map()
      const pendingLastHashes = new Map()

      for (const record of batch) {
        const sessionId = normalizeTrimmedString(record.sessionId) || 'system'
        const filePath = join(this.auditDir, `${toSafeFileName(sessionId)}.jsonl`)
        const lines = groupedLines.get(filePath) || []
        let previousHash = pendingLastHashes.has(filePath)
          ? pendingLastHashes.get(filePath)
          : this.lastHashes.get(filePath)

        if (previousHash == null) {
          previousHash = await readLastAuditHash(filePath)
        }

        const chainedRecord = {
          ...record,
          prevHash: previousHash
        }
        chainedRecord.hash = hashRecord(chainedRecord)
        pendingLastHashes.set(filePath, chainedRecord.hash)
        lines.push(`${JSON.stringify(chainedRecord)}\n`)
        groupedLines.set(filePath, lines)
      }

      await Promise.all(
        [...groupedLines.entries()].map(([filePath, lines]) => (
          appendFile(filePath, lines.join(''), 'utf8')
        ))
      )

      for (const [filePath, hash] of pendingLastHashes) {
        this.lastHashes.set(filePath, hash)
      }
    } catch (error) {
      this.queue.unshift(...batch)

      while (this.queue.length > this.maxQueueSize) {
        this.queue.shift()
        this.dropCount += 1
      }

      throw error
    } finally {
      this.flushing = false

      if (this.queue.length) {
        this.scheduleFlush()
      }
    }
  }

  async deleteSessionAuditRecords(sessionId) {
    const normalizedSessionId = normalizeTrimmedString(sessionId)

    if (!normalizedSessionId || !this.auditDir) {
      return {
        ok: false,
        deletedQueuedCount: 0,
        deletedFile: false,
        reason: normalizedSessionId ? 'audit_dir_required' : 'session_id_required'
      }
    }

    while (this.flushing) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const filePath = join(this.auditDir, `${toSafeFileName(normalizedSessionId)}.jsonl`)
    const beforeQueueLength = this.queue.length
    this.queue = this.queue.filter((record) => (
      normalizeTrimmedString(record?.sessionId) !== normalizedSessionId
    ))
    const deletedQueuedCount = beforeQueueLength - this.queue.length
    this.lastHashes.delete(filePath)

    try {
      await rm(filePath, { force: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }

    return {
      ok: true,
      deletedQueuedCount,
      deletedFile: true
    }
  }

  async shutdown() {
    this.closed = true
    clearInterval(this.timer)

    while (this.queue.length) {
      await this.flush()
    }
  }
}

export function createAuditLogger(options = {}) {
  return new AuditLogger(options)
}
