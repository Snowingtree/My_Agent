import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { normalizeTrimmedString, nowIso } from './utils.js'

const DEFAULT_DATABASE_FILE = 'agent-memory.sqlite'
const DEFAULT_PROFILE_FILE = 'user_profile.md'
const DEFAULT_MAX_PROFILE_CHARS = 8000
const DEFAULT_MAX_SUMMARY_CHARS = 6000
const SENSITIVE_LINE_PATTERN = /(api[-_ ]?key|authorization|password|secret|token|access[-_ ]?token|refresh[-_ ]?token|cookie|credential|private[-_ ]?key)/i

function normalizeMaxChars(value, fallbackValue) {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallbackValue
}

function sanitizeMemoryText(value, maxChars) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return ''
  }

  const safeLines = normalized
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !SENSITIVE_LINE_PATTERN.test(line))
    .join('\n')
    .trim()

  return safeLines.length > maxChars
    ? safeLines.slice(0, maxChars).trim()
    : safeLines
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

function normalizeCount(value) {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0
}

export class SqliteMemoryStore {
  constructor({
    memoryDir,
    databasePath,
    databaseFile = DEFAULT_DATABASE_FILE,
    profileFile = DEFAULT_PROFILE_FILE,
    maxProfileChars = DEFAULT_MAX_PROFILE_CHARS,
    maxSummaryChars = DEFAULT_MAX_SUMMARY_CHARS
  } = {}) {
    this.memoryDir = normalizeTrimmedString(memoryDir)
    this.databaseFile = normalizeTrimmedString(databaseFile) || DEFAULT_DATABASE_FILE
    this.profileFile = normalizeTrimmedString(profileFile) || DEFAULT_PROFILE_FILE
    this.maxProfileChars = normalizeMaxChars(maxProfileChars, DEFAULT_MAX_PROFILE_CHARS)
    this.maxSummaryChars = normalizeMaxChars(maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS)
    this.databasePath = normalizeTrimmedString(databasePath) || (this.memoryDir ? join(this.memoryDir, this.databaseFile) : '')
    this.legacyProfilePath = this.memoryDir ? join(this.memoryDir, this.profileFile) : ''
    this.didAttemptLegacyProfileMigration = false
    this.db = null

    if (this.databasePath) {
      mkdirSync(dirname(this.databasePath), { recursive: true })
      this.db = new DatabaseSync(this.databasePath)
      this.initialize()
    }
  }

  initialize() {
    if (!this.db) {
      return
    }

    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS user_profile_memory (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        profile TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_memory (
        session_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL DEFAULT '',
        compressed_through_message_id TEXT NOT NULL DEFAULT '',
        compressed_message_count INTEGER NOT NULL DEFAULT 0,
        kept_message_count INTEGER NOT NULL DEFAULT 0,
        compressed_turn_count INTEGER NOT NULL DEFAULT 0,
        kept_turn_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        usage_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_events_session_created
        ON memory_events(session_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_memory_events_type_created
        ON memory_events(event_type, created_at);

      CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_id
        ON conversation_messages(session_id, id);
    `)
    this.ensureConversationMemorySchema()
  }

  ensureConversationMemorySchema() {
    if (!this.db) {
      return
    }

    const columns = new Set(
      this.db
        .prepare('PRAGMA table_info(conversation_memory)')
        .all()
        .map((column) => normalizeTrimmedString(column?.name))
        .filter(Boolean)
    )

    if (!columns.has('compressed_turn_count')) {
      this.db.exec('ALTER TABLE conversation_memory ADD COLUMN compressed_turn_count INTEGER NOT NULL DEFAULT 0')
    }

    if (!columns.has('kept_turn_count')) {
      this.db.exec('ALTER TABLE conversation_memory ADD COLUMN kept_turn_count INTEGER NOT NULL DEFAULT 0')
    }
  }

  ensureEnabled() {
    if (!this.db) {
      return false
    }

    return true
  }

  recordEvent(eventType, payload = {}, sessionId = '') {
    if (!this.ensureEnabled()) {
      return
    }

    this.db.prepare(`
      INSERT INTO memory_events (session_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      normalizeTrimmedString(sessionId),
      normalizeTrimmedString(eventType) || 'memory_event',
      safeJsonStringify(payload),
      nowIso()
    )
  }

  async migrateLegacyProfileIfNeeded() {
    if (this.didAttemptLegacyProfileMigration || !this.ensureEnabled()) {
      return
    }

    this.didAttemptLegacyProfileMigration = true

    const existingRow = this.db.prepare('SELECT profile FROM user_profile_memory WHERE id = 1').get()

    if (normalizeTrimmedString(existingRow?.profile)) {
      return
    }

    if (!this.legacyProfilePath) {
      return
    }

    try {
      const legacyProfile = sanitizeMemoryText(
        await readFile(this.legacyProfilePath, 'utf8'),
        this.maxProfileChars
      )

      if (!legacyProfile) {
        return
      }

      const timestamp = nowIso()
      this.db.prepare(`
        INSERT INTO user_profile_memory (id, profile, reason, created_at, updated_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          profile = excluded.profile,
          reason = excluded.reason,
          updated_at = excluded.updated_at
      `).run(legacyProfile, 'legacy_profile_import', timestamp, timestamp)
      this.recordEvent('user_profile_memory_imported', {
        source: this.legacyProfilePath,
        profileLength: legacyProfile.length
      })
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
  }

  async readUserProfile() {
    if (!this.ensureEnabled()) {
      return ''
    }

    await this.migrateLegacyProfileIfNeeded()

    const row = this.db.prepare('SELECT profile FROM user_profile_memory WHERE id = 1').get()
    return sanitizeMemoryText(row?.profile || '', this.maxProfileChars)
  }

  async writeUserProfile(content, metadata = {}) {
    if (!this.ensureEnabled()) {
      return {
        ok: false,
        profile: '',
        updatedAt: null,
        reason: 'memory_store_disabled'
      }
    }

    const profile = sanitizeMemoryText(content, this.maxProfileChars)
    const reason = normalizeTrimmedString(metadata?.reason)
    const timestamp = nowIso()

    this.db.prepare(`
      INSERT INTO user_profile_memory (id, profile, reason, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        profile = excluded.profile,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `).run(profile, reason, timestamp, timestamp)

    this.recordEvent('user_profile_memory_updated', {
      profileLength: profile.length,
      reason
    })

    return {
      ok: true,
      profile,
      updatedAt: timestamp,
      databasePath: this.databasePath,
      storageType: 'sqlite',
      reason
    }
  }

  async readConversationMemory(sessionId, { maxChars = this.maxSummaryChars } = {}) {
    if (!this.ensureEnabled()) {
      return {
        summary: '',
        updatedAt: null,
        compressedThroughMessageId: '',
        compressedMessageCount: 0,
        keptMessageCount: 0,
        compressedTurnCount: 0,
        keptTurnCount: 0
      }
    }

    const normalizedSessionId = normalizeTrimmedString(sessionId)

    if (!normalizedSessionId) {
      return {
        summary: '',
        updatedAt: null,
        compressedThroughMessageId: '',
        compressedMessageCount: 0,
        keptMessageCount: 0,
        compressedTurnCount: 0,
        keptTurnCount: 0
      }
    }

    const row = this.db.prepare(`
      SELECT
        summary,
        compressed_through_message_id AS compressedThroughMessageId,
        compressed_message_count AS compressedMessageCount,
        kept_message_count AS keptMessageCount,
        compressed_turn_count AS compressedTurnCount,
        kept_turn_count AS keptTurnCount,
        updated_at AS updatedAt
      FROM conversation_memory
      WHERE session_id = ?
    `).get(normalizedSessionId)

    if (!row) {
      return {
        summary: '',
        updatedAt: null,
        compressedThroughMessageId: '',
        compressedMessageCount: 0,
        keptMessageCount: 0,
        compressedTurnCount: 0,
        keptTurnCount: 0
      }
    }

    return {
      summary: sanitizeMemoryText(row.summary || '', normalizeMaxChars(maxChars, this.maxSummaryChars)),
      updatedAt: normalizeTrimmedString(row.updatedAt) || null,
      compressedThroughMessageId: normalizeTrimmedString(row.compressedThroughMessageId),
      compressedMessageCount: normalizeCount(row.compressedMessageCount),
      keptMessageCount: normalizeCount(row.keptMessageCount),
      compressedTurnCount: normalizeCount(row.compressedTurnCount),
      keptTurnCount: normalizeCount(row.keptTurnCount)
    }
  }

  async writeConversationMemory({
    sessionId,
    summary,
    compressedThroughMessageId = '',
    compressedMessageCount = 0,
    keptMessageCount = 0,
    compressedTurnCount = compressedMessageCount,
    keptTurnCount = keptMessageCount,
    reason = ''
  } = {}) {
    if (!this.ensureEnabled()) {
      return {
        ok: false,
        summary: '',
        updatedAt: null,
        reason: 'memory_store_disabled'
      }
    }

    const normalizedSessionId = normalizeTrimmedString(sessionId)

    if (!normalizedSessionId) {
      return {
        ok: false,
        summary: '',
        updatedAt: null,
        reason: 'session_id_required'
      }
    }

    const nextSummary = sanitizeMemoryText(summary, this.maxSummaryChars)
    const timestamp = nowIso()
    const nextCompressedThroughMessageId = normalizeTrimmedString(compressedThroughMessageId)
    const nextCompressedMessageCount = normalizeCount(compressedMessageCount)
    const nextKeptMessageCount = normalizeCount(keptMessageCount)
    const nextCompressedTurnCount = normalizeCount(compressedTurnCount)
    const nextKeptTurnCount = normalizeCount(keptTurnCount)

    this.db.prepare(`
      INSERT INTO conversation_memory (
        session_id,
        summary,
        compressed_through_message_id,
        compressed_message_count,
        kept_message_count,
        compressed_turn_count,
        kept_turn_count,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        summary = excluded.summary,
        compressed_through_message_id = excluded.compressed_through_message_id,
        compressed_message_count = excluded.compressed_message_count,
        kept_message_count = excluded.kept_message_count,
        compressed_turn_count = excluded.compressed_turn_count,
        kept_turn_count = excluded.kept_turn_count,
        updated_at = excluded.updated_at
    `).run(
      normalizedSessionId,
      nextSummary,
      nextCompressedThroughMessageId,
      nextCompressedMessageCount,
      nextKeptMessageCount,
      nextCompressedTurnCount,
      nextKeptTurnCount,
      timestamp,
      timestamp
    )

    this.recordEvent('conversation_memory_compacted', {
      summaryLength: nextSummary.length,
      compressedThroughMessageId: nextCompressedThroughMessageId,
      compressedMessageCount: nextCompressedMessageCount,
      keptMessageCount: nextKeptMessageCount,
      compressedTurnCount: nextCompressedTurnCount,
      keptTurnCount: nextKeptTurnCount,
      reason: normalizeTrimmedString(reason)
    }, normalizedSessionId)

    return {
      ok: true,
      summary: nextSummary,
      updatedAt: timestamp,
      compressedThroughMessageId: nextCompressedThroughMessageId,
      compressedMessageCount: nextCompressedMessageCount,
      keptMessageCount: nextKeptMessageCount,
      compressedTurnCount: nextCompressedTurnCount,
      keptTurnCount: nextKeptTurnCount,
      databasePath: this.databasePath,
      storageType: 'sqlite'
    }
  }

  normalizeConversationMessage(message = {}) {
    const messageId = normalizeTrimmedString(message?.messageId)

    if (!messageId) {
      return null
    }

    return {
      messageId,
      role: normalizeTrimmedString(message?.role) || 'assistant',
      content: String(message?.content ?? ''),
      createdAt: normalizeTrimmedString(message?.createdAt) || nowIso(),
      model: normalizeTrimmedString(message?.model),
      usage: message?.usage && typeof message.usage === 'object' ? message.usage : null
    }
  }

  rowToConversationMessage(row) {
    if (!row) {
      return null
    }

    let usage = null

    try {
      usage = row.usage_json ? JSON.parse(row.usage_json) : null
    } catch {
      usage = null
    }

    return {
      messageId: normalizeTrimmedString(row.message_id),
      role: normalizeTrimmedString(row.role) || 'assistant',
      content: String(row.content ?? ''),
      createdAt: normalizeTrimmedString(row.created_at) || nowIso(),
      model: normalizeTrimmedString(row.model),
      usage
    }
  }

  async appendConversationMessage(sessionId, message = {}) {
    if (!this.ensureEnabled()) {
      return null
    }

    const normalizedSessionId = normalizeTrimmedString(sessionId)
    const normalizedMessage = this.normalizeConversationMessage(message)

    if (!normalizedSessionId || !normalizedMessage) {
      return null
    }

    this.db.prepare(`
      INSERT INTO conversation_messages (
        message_id,
        session_id,
        role,
        content,
        model,
        usage_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        session_id = excluded.session_id,
        role = excluded.role,
        content = excluded.content,
        model = excluded.model,
        usage_json = excluded.usage_json,
        created_at = excluded.created_at
    `).run(
      normalizedMessage.messageId,
      normalizedSessionId,
      normalizedMessage.role,
      normalizedMessage.content,
      normalizedMessage.model,
      safeJsonStringify(normalizedMessage.usage),
      normalizedMessage.createdAt
    )

    return normalizedMessage
  }

  async replaceConversationMessages(sessionId, messages = []) {
    if (!this.ensureEnabled()) {
      return {
        ok: false,
        messageCount: 0,
        reason: 'memory_store_disabled'
      }
    }

    const normalizedSessionId = normalizeTrimmedString(sessionId)

    if (!normalizedSessionId) {
      return {
        ok: false,
        messageCount: 0,
        reason: 'session_id_required'
      }
    }

    const normalizedMessages = Array.isArray(messages)
      ? messages.map((message) => this.normalizeConversationMessage(message)).filter(Boolean)
      : []
    const transaction = this.db.prepare('DELETE FROM conversation_messages WHERE session_id = ?')

    this.db.exec('BEGIN IMMEDIATE')

    try {
      transaction.run(normalizedSessionId)
      const insertStatement = this.db.prepare(`
        INSERT INTO conversation_messages (
          message_id,
          session_id,
          role,
          content,
          model,
          usage_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      for (const message of normalizedMessages) {
        insertStatement.run(
          message.messageId,
          normalizedSessionId,
          message.role,
          message.content,
          message.model,
          safeJsonStringify(message.usage),
          message.createdAt
        )
      }

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    this.recordEvent('conversation_messages_replaced', {
      messageCount: normalizedMessages.length
    }, normalizedSessionId)

    return {
      ok: true,
      messageCount: normalizedMessages.length,
      storageType: 'sqlite'
    }
  }

  async listConversationMessages(sessionId, { limit = 0 } = {}) {
    if (!this.ensureEnabled()) {
      return []
    }

    const normalizedSessionId = normalizeTrimmedString(sessionId)

    if (!normalizedSessionId) {
      return []
    }

    const normalizedLimit = Math.max(0, Number.parseInt(limit, 10) || 0)
    const rows = normalizedLimit > 0
      ? this.db.prepare(`
          SELECT message_id, role, content, model, usage_json, created_at
          FROM conversation_messages
          WHERE session_id = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(normalizedSessionId, normalizedLimit).reverse()
      : this.db.prepare(`
          SELECT message_id, role, content, model, usage_json, created_at
          FROM conversation_messages
          WHERE session_id = ?
          ORDER BY id ASC
        `).all(normalizedSessionId)

    return rows.map((row) => this.rowToConversationMessage(row)).filter(Boolean)
  }

  async getConversationMessageCount(sessionId) {
    if (!this.ensureEnabled()) {
      return 0
    }

    const normalizedSessionId = normalizeTrimmedString(sessionId)

    if (!normalizedSessionId) {
      return 0
    }

    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM conversation_messages
      WHERE session_id = ?
    `).get(normalizedSessionId)

    return normalizeCount(row?.count)
  }

  async deleteConversationMessages(sessionId) {
    if (!this.ensureEnabled()) {
      return {
        ok: false,
        deletedCount: 0,
        reason: 'memory_store_disabled'
      }
    }

    const normalizedSessionId = normalizeTrimmedString(sessionId)

    if (!normalizedSessionId) {
      return {
        ok: false,
        deletedCount: 0,
        reason: 'session_id_required'
      }
    }

    const result = this.db.prepare('DELETE FROM conversation_messages WHERE session_id = ?').run(normalizedSessionId)
    this.recordEvent('conversation_messages_deleted', {
      deletedCount: normalizeCount(result?.changes)
    }, normalizedSessionId)

    return {
      ok: true,
      deletedCount: normalizeCount(result?.changes),
      storageType: 'sqlite'
    }
  }

  async getStatus() {
    if (!this.ensureEnabled()) {
      return {
        enabled: false,
        storageType: 'sqlite',
        databasePath: '',
        maxProfileChars: this.maxProfileChars,
        maxSummaryChars: this.maxSummaryChars,
        hasProfile: false,
        profileChars: 0,
        conversationMemoryCount: 0,
        conversationMessageCount: 0,
        eventCount: 0
      }
    }

    const profile = await this.readUserProfile()
    const conversationMemoryRow = this.db.prepare('SELECT COUNT(*) AS count FROM conversation_memory').get()
    const conversationMessageRow = this.db.prepare('SELECT COUNT(*) AS count FROM conversation_messages').get()
    const eventRow = this.db.prepare('SELECT COUNT(*) AS count FROM memory_events').get()

    return {
      enabled: true,
      storageType: 'sqlite',
      databasePath: this.databasePath,
      legacyProfilePath: this.legacyProfilePath,
      maxProfileChars: this.maxProfileChars,
      maxSummaryChars: this.maxSummaryChars,
      hasProfile: Boolean(profile),
      profileChars: profile.length,
      conversationMemoryCount: normalizeCount(conversationMemoryRow?.count),
      conversationMessageCount: normalizeCount(conversationMessageRow?.count),
      eventCount: normalizeCount(eventRow?.count)
    }
  }

  close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

export function createSqliteMemoryStore(options = {}) {
  return new SqliteMemoryStore(options)
}
