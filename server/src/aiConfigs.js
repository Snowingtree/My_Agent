import { existsSync, readFileSync } from 'node:fs'
import { decryptStoredOpenAiApiKey } from './openAiKeyCrypto.js'
import { parseList, normalizeTrimmedString } from './utils.js'

const VALID_AI_CONFIG_SOURCE_MODES = new Set(['env', 'file', 'mysql'])
const DEFAULT_FILE_AI_ID = 'primary'
let mysqlPoolPromise = null

function normalizeEnvValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBaseUrl(value) {
  return normalizeTrimmedString(value).replace(/\/$/, '')
}

function parseMysqlPort(value, envKey) {
  const normalized = normalizeEnvValue(value)

  if (!normalized) {
    return 3306
  }

  const parsedValue = Number.parseInt(normalized, 10)

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${envKey} must be a positive integer.`)
  }

  return parsedValue
}

function quoteIdentifier(value, envKey) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${envKey} may only contain letters, numbers, and underscores.`)
  }

  return `\`${value}\``
}

function getRequiredMysqlConfigKeys(config) {
  return Object.entries({
    host: config.host,
    user: config.user,
    database: config.database
  })
    .filter(([, value]) => !value)
    .map(([key]) => key)
}

function getMysqlConnectionConfig() {
  const config = {
    host: normalizeEnvValue(process.env.MYSQL_HOST),
    port: parseMysqlPort(process.env.MYSQL_PORT, 'MYSQL_PORT'),
    user: normalizeEnvValue(process.env.MYSQL_USER),
    password: normalizeEnvValue(process.env.MYSQL_PASSWORD),
    database: normalizeEnvValue(process.env.MYSQL_DATABASE)
  }

  const missingKeys = getRequiredMysqlConfigKeys(config).map((key) => `MYSQL_${key.toUpperCase()}`)

  if (missingKeys.length) {
    throw new Error(`Missing MySQL config: ${missingKeys.join(', ')}`)
  }

  return config
}

function hasMysqlConnectionHints() {
  return Boolean(
    normalizeEnvValue(process.env.MYSQL_HOST)
    || normalizeEnvValue(process.env.AI_SETTINGS_MYSQL_HOST)
    || normalizeEnvValue(process.env.OPENAI_KEY_MYSQL_HOST)
  )
}

function getAiSettingsMysqlConfig() {
  const sharedConfig = getMysqlConnectionConfig()
  const config = {
    host:
      normalizeEnvValue(process.env.AI_SETTINGS_MYSQL_HOST)
      || normalizeEnvValue(process.env.OPENAI_KEY_MYSQL_HOST)
      || sharedConfig.host,
    port: parseMysqlPort(
      normalizeEnvValue(process.env.AI_SETTINGS_MYSQL_PORT)
      || normalizeEnvValue(process.env.OPENAI_KEY_MYSQL_PORT)
      || String(sharedConfig.port),
      'AI_SETTINGS_MYSQL_PORT'
    ),
    user:
      normalizeEnvValue(process.env.AI_SETTINGS_MYSQL_USER)
      || normalizeEnvValue(process.env.OPENAI_KEY_MYSQL_USER)
      || sharedConfig.user,
    password:
      normalizeEnvValue(process.env.AI_SETTINGS_MYSQL_PASSWORD)
      || normalizeEnvValue(process.env.OPENAI_KEY_MYSQL_PASSWORD)
      || sharedConfig.password,
    database:
      normalizeEnvValue(process.env.AI_SETTINGS_MYSQL_DATABASE)
      || normalizeEnvValue(process.env.OPENAI_KEY_MYSQL_DATABASE)
      || sharedConfig.database,
    table:
      normalizeEnvValue(process.env.AI_SETTINGS_MYSQL_TABLE)
      || normalizeEnvValue(process.env.OPENAI_KEY_MYSQL_TABLE)
      || 'ai_provider_configs'
  }

  const missingKeys = getRequiredMysqlConfigKeys(config).map(
    (key) => `AI_SETTINGS_MYSQL_${key.toUpperCase()}`
  )

  if (missingKeys.length) {
    throw new Error(`Missing AI settings MySQL config: ${missingKeys.join(', ')}`)
  }

  return config
}

async function loadMysqlLibrary() {
  try {
    const mysqlModule = await import('mysql2/promise')
    return mysqlModule.default ?? mysqlModule
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.includes('mysql2')
        || error.message.includes('Cannot find package')
        || error.message.includes('Cannot find module')
      )
    ) {
      throw new Error(
        'Agent AI config storage requires the mysql2 package. Run "cd server && npm install" before enabling MySQL config loading.'
      )
    }

    throw error
  }
}

function normalizeStoredApiKey(value) {
  const normalized = decryptStoredOpenAiApiKey(value, process.env)

  if (!normalized) {
    return ''
  }

  if (normalized.length > 4096 || /[\0\r\n\t]/.test(normalized)) {
    return ''
  }

  return normalized
}

function resolveEnvApiKey(envName) {
  return envName ? normalizeTrimmedString(process.env[envName]) : ''
}

function resolveApiKey(item) {
  const directValue = normalizeStoredApiKey(item?.apiKey)

  if (directValue) {
    return directValue
  }

  return resolveEnvApiKey(normalizeTrimmedString(item?.apiKeyEnv))
}

function normalizeAiConfig(item, index) {
  const aiId = normalizeTrimmedString(item?.aiId) || `config-${index + 1}`
  const baseURL = normalizeBaseUrl(item?.baseURL || item?.aiBaseUrl)
  const models = parseList(item?.models || item?.aiVersions)
  const defaultModel = normalizeTrimmedString(item?.defaultModel) || models[0] || ''

  if (!baseURL || !defaultModel) {
    return null
  }

  return {
    aiId,
    name: normalizeTrimmedString(item?.name) || aiId,
    baseURL,
    apiKey: resolveApiKey(item),
    apiKeyEnv: normalizeTrimmedString(item?.apiKeyEnv),
    models: models.length ? models : [defaultModel],
    defaultModel,
    systemPrompt: normalizeTrimmedString(item?.systemPrompt),
    source: normalizeTrimmedString(item?.source) || 'file'
  }
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null
  }

  const rawContent = readFileSync(filePath, 'utf8')

  if (!rawContent.trim()) {
    return null
  }

  return JSON.parse(rawContent)
}

function readSingleEnvConfig() {
  const baseURL = normalizeBaseUrl(process.env.AGENT_AI_BASE_URL || process.env.OPENAI_BASE_URL)
  const apiKey = normalizeStoredApiKey(process.env.AGENT_AI_API_KEY || process.env.OPENAI_API_KEY)
  const models = parseList(
    process.env.AGENT_AI_MODELS
    || process.env.AGENT_AI_MODEL
    || process.env.OPENAI_MODELS
    || process.env.OPENAI_MODEL
  )
  const defaultModel = normalizeTrimmedString(
    process.env.AGENT_AI_MODEL || process.env.OPENAI_MODEL
  ) || models[0] || ''

  if (!baseURL || !defaultModel) {
    return []
  }

  return [{
    aiId: normalizeTrimmedString(process.env.AGENT_AI_ID) || DEFAULT_FILE_AI_ID,
    name: normalizeTrimmedString(process.env.AGENT_AI_NAME || process.env.OPENAI_AI_NAME) || 'Primary Model',
    baseURL,
    apiKey,
    models: models.length ? models : [defaultModel],
    defaultModel,
    source: 'env'
  }]
}

function readRawConfigs(configPath) {
  const inlineConfigs = normalizeTrimmedString(process.env.AGENT_AI_CONFIGS_JSON)

  if (inlineConfigs) {
    return JSON.parse(inlineConfigs)
  }

  const fileConfig = readJsonFile(configPath)

  if (fileConfig) {
    return fileConfig
  }

  return readSingleEnvConfig()
}

function resolveAiConfigSourceMode(aiRuntimeConfig) {
  const explicitMode = normalizeEnvValue(process.env.AGENT_AI_CONFIG_SOURCE).toLowerCase()

  if (explicitMode) {
    if (!VALID_AI_CONFIG_SOURCE_MODES.has(explicitMode)) {
      throw new Error('AGENT_AI_CONFIG_SOURCE must be one of "mysql", "env", or "file".')
    }

    return explicitMode
  }

  const legacyOpenAiStorageMode = normalizeEnvValue(process.env.OPENAI_API_KEY_STORAGE).toLowerCase()

  if (legacyOpenAiStorageMode === 'mysql') {
    return 'mysql'
  }

  if (hasMysqlConnectionHints()) {
    return 'mysql'
  }

  if (normalizeEnvValue(process.env.AGENT_AI_API_KEY || process.env.OPENAI_API_KEY)) {
    return 'env'
  }

  const fileConfig = readJsonFile(aiRuntimeConfig.configPath)

  return fileConfig ? 'file' : 'env'
}

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName])
  return Array.isArray(rows) && rows.length > 0
}

async function ensureMysqlTable(connection, tableName) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS ${tableName} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ai_name VARCHAR(120) NOT NULL,
      ai_id VARCHAR(120) NOT NULL,
      ai_versions VARCHAR(1000) NOT NULL DEFAULT '',
      ai_base_url VARCHAR(2048) NOT NULL DEFAULT '',
      api_key TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ai_id (ai_id),
      KEY idx_ai_name (ai_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  )

  const [hasApiVersionsColumn, hasAiBaseUrlColumn, hasApiKeyColumn, hasLegacyTokenColumn] = await Promise.all([
    hasColumn(connection, tableName, 'ai_versions'),
    hasColumn(connection, tableName, 'ai_base_url'),
    hasColumn(connection, tableName, 'api_key'),
    hasColumn(connection, tableName, 'token')
  ])

  if (!hasApiVersionsColumn) {
    await connection.query(
      `ALTER TABLE ${tableName} ADD COLUMN ai_versions VARCHAR(1000) NOT NULL DEFAULT '' AFTER ai_id`
    )
  }

  if (!hasAiBaseUrlColumn) {
    await connection.query(
      `ALTER TABLE ${tableName} ADD COLUMN ai_base_url VARCHAR(2048) NOT NULL DEFAULT '' AFTER ai_versions`
    )
  }

  if (!hasApiKeyColumn && hasLegacyTokenColumn) {
    await connection.query(
      `ALTER TABLE ${tableName} CHANGE COLUMN token api_key TEXT NOT NULL`
    )
  }
}

async function getMysqlPool() {
  if (!mysqlPoolPromise) {
    const mysql = await loadMysqlLibrary()
    const config = getAiSettingsMysqlConfig()

    mysqlPoolPromise = Promise.resolve(
      mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        connectionLimit: 10,
        waitForConnections: true,
        charset: 'utf8mb4'
      })
    )
  }

  return mysqlPoolPromise
}

async function withMysqlConnection(handler) {
  const pool = await getMysqlPool()
  const connection = await pool.getConnection()
  const config = getAiSettingsMysqlConfig()
  const tableName = quoteIdentifier(config.table, 'AI_SETTINGS_MYSQL_TABLE')

  try {
    await ensureMysqlTable(connection, tableName)
    return await handler(connection, tableName)
  } finally {
    connection.release()
  }
}

async function readMysqlConfigs() {
  return withMysqlConnection(async (connection, tableName) => {
    let rows = []

    try {
      ;[rows] = await connection.query(
        `SELECT
          id,
          ai_name AS name,
          ai_id AS aiId,
          ai_versions AS aiVersions,
          ai_base_url AS aiBaseUrl,
          api_key AS apiKey
        FROM ${tableName}
        ORDER BY updated_at DESC, id DESC`
      )
    } catch (error) {
      if (
        !(error instanceof Error)
        || !('code' in error)
        || error.code !== 'ER_BAD_FIELD_ERROR'
      ) {
        throw error
      }

      try {
        ;[rows] = await connection.query(
          `SELECT
            id,
            ai_name AS name,
            ai_id AS aiId,
            ai_versions AS aiVersions,
            ai_base_url AS aiBaseUrl,
            token AS apiKey
          FROM ${tableName}
          ORDER BY updated_at DESC, id DESC`
        )
      } catch (legacyError) {
        if (
          !(legacyError instanceof Error)
          || !('code' in legacyError)
          || legacyError.code !== 'ER_BAD_FIELD_ERROR'
        ) {
          throw legacyError
        }

        ;[rows] = await connection.query(
          `SELECT
            id,
            name,
            name AS aiId,
            '' AS aiVersions,
            '' AS aiBaseUrl,
            api_key AS apiKey
          FROM ${tableName}
          WHERE is_active = 1
          ORDER BY priority ASC, id ASC`
        )
      }
    }

    return (Array.isArray(rows) ? rows : [])
      .map((row, index) => normalizeAiConfig({
        aiId: normalizeTrimmedString(row.aiId) || `mysql-${row.id || index + 1}`,
        name: normalizeTrimmedString(row.name) || normalizeTrimmedString(row.aiId),
        aiVersions: normalizeTrimmedString(row.aiVersions),
        aiBaseUrl: normalizeTrimmedString(row.aiBaseUrl),
        apiKey: normalizeStoredApiKey(row.apiKey),
        source: 'mysql'
      }, index))
      .filter(Boolean)
  })
}

export async function loadAiConfigs(aiRuntimeConfig) {
  const sourceMode = resolveAiConfigSourceMode(aiRuntimeConfig)

  if (sourceMode === 'mysql') {
    return readMysqlConfigs()
  }

  const rawValue = readRawConfigs(aiRuntimeConfig.configPath)
  const items = Array.isArray(rawValue)
    ? rawValue
    : Array.isArray(rawValue?.items)
      ? rawValue.items
      : []

  return items
    .map((item, index) => normalizeAiConfig(item, index))
    .filter(Boolean)
}

export async function getAiConfigById(aiRuntimeConfig, aiId) {
  const configs = await loadAiConfigs(aiRuntimeConfig)
  const normalizedAiId = normalizeTrimmedString(aiId)

  if (!configs.length) {
    return null
  }

  if (!normalizedAiId) {
    return configs[0]
  }

  return configs.find((item) => item.aiId === normalizedAiId) || null
}

export function resolveModel(aiConfig, requestedModel) {
  const normalizedRequestedModel = normalizeTrimmedString(requestedModel)

  if (normalizedRequestedModel && aiConfig.models.includes(normalizedRequestedModel)) {
    return normalizedRequestedModel
  }

  return aiConfig.defaultModel || aiConfig.models[0] || ''
}

export function toPublicAiConfig(aiConfig) {
  return {
    aiId: aiConfig.aiId,
    name: aiConfig.name,
    aiBaseUrl: aiConfig.baseURL,
    aiVersions: aiConfig.models.join(','),
    hasApiKey: Boolean(aiConfig.apiKey)
  }
}

function generateAiId(name) {
  const normalized = String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  return normalized || `config-${Date.now()}`
}

export async function insertAiConfig({ name, aiVersions, aiBaseUrl, apiKey } = {}) {
  const normalizedName = normalizeTrimmedString(name)
  const normalizedBaseUrl = normalizeBaseUrl(aiBaseUrl)
  const normalizedVersions = normalizeTrimmedString(aiVersions)
  const normalizedApiKey = normalizeStoredApiKey(apiKey) || normalizeTrimmedString(apiKey)

  if (!normalizedName) {
    throw new Error('AI 名称不能为空。')
  }

  if (!normalizedBaseUrl) {
    throw new Error('接口地址不能为空。')
  }

  if (!normalizedApiKey) {
    throw new Error('API Key 不能为空。')
  }

  const aiId = generateAiId(normalizedName)

  await withMysqlConnection(async (connection, tableName) => {
    const [existing] = await connection.query(
      `SELECT id FROM ${tableName} WHERE ai_id = ? LIMIT 1`,
      [aiId]
    )

    if (Array.isArray(existing) && existing.length > 0) {
      await connection.query(
        `UPDATE ${tableName} SET ai_name = ?, ai_versions = ?, ai_base_url = ?, api_key = ? WHERE ai_id = ?`,
        [normalizedName, normalizedVersions, normalizedBaseUrl, normalizedApiKey, aiId]
      )
    } else {
      await connection.query(
        `INSERT INTO ${tableName} (ai_name, ai_id, ai_versions, ai_base_url, api_key) VALUES (?, ?, ?, ?, ?)`,
        [normalizedName, aiId, normalizedVersions, normalizedBaseUrl, normalizedApiKey]
      )
    }
  })

  return { aiId, name: normalizedName }
}
