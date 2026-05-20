import { createServer } from 'node:http'
import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import mammoth from 'mammoth'
import { createAuditLogger } from './auditLogger.js'
import { createConfig } from './config.js'
import { createEmbeddingClient } from './embeddingClient.js'
import { loadEnvFiles } from './env.js'
import { createAuthToken, readBearerToken, verifyAuthToken } from './auth.js'
import { getAiConfigById, insertAiConfig, loadAiConfigs, resolveModel, toPublicAiConfig, updateAiConfig } from './aiConfigs.js'
import { createAgentRunner } from './agentRunner.js'
import { createMcpRegistry } from './mcpRegistry.js'
import { createSqliteMemoryStore } from './sqliteMemoryStore.js'
import { createRagStore } from './ragStore.js'
import { createSessionWorkspacesRepository } from './sessionWorkspaces.js'
import { createSkillLibrary } from './skillLibrary.js'
import { SessionRepository } from './sessionStore.js'
import { createSkillRegistry } from './skillRegistry.js'
import { createTokenUsageStore } from './tokenUsageStore.js'
import { getToolDetailItem, listToolPreviewItems } from './toolCatalogDetails.js'
import {
  isToolApprovalConfirmation,
  isToolApprovalDenial
} from './toolApproval.js'
import { createToolRunner } from './toolRunner.js'
import { createId, normalizeTrimmedString } from './utils.js'
import { createWorkspace } from './workspace.js'

loadEnvFiles()

const config = createConfig()
const MCP_DISABLED_SELECTION = '__mcp_disabled__'
const MCP_ALL_SELECTION = '__mcp_all__'
const WORKSPACE_PREVIEW_TOKEN_TYPE = 'workspace_preview'
const WORKSPACE_PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000
let sessionWorkspaces = null
const sessionStreamSubscribers = new Map()
const tokenUsageStore = createTokenUsageStore(config.storage.tokenUsageFile)
const auditLogger = createAuditLogger({
  auditDir: config.storage.auditDir
})
const memoryStore = createSqliteMemoryStore({
  memoryDir: config.storage.memoryDir,
  maxProfileChars: config.ai.userProfileMemoryMaxChars,
  maxSummaryChars: config.ai.contextMemoryMaxChars
})

function subscribeToSessionStream(sessionId, listener) {
  const normalizedSessionId = normalizeTrimmedString(sessionId)

  if (!normalizedSessionId || typeof listener !== 'function') {
    return () => {}
  }

  const listeners = sessionStreamSubscribers.get(normalizedSessionId) || new Set()
  listeners.add(listener)
  sessionStreamSubscribers.set(normalizedSessionId, listeners)

  return () => {
    const activeListeners = sessionStreamSubscribers.get(normalizedSessionId)

    if (!activeListeners) {
      return
    }

    activeListeners.delete(listener)

    if (!activeListeners.size) {
      sessionStreamSubscribers.delete(normalizedSessionId)
    }
  }
}

function publishSessionStreamEvent(sessionId, event) {
  const normalizedSessionId = normalizeTrimmedString(sessionId)
  const listeners = sessionStreamSubscribers.get(normalizedSessionId)

  if (!normalizedSessionId || !listeners?.size) {
    return
  }

  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.warn('[agent-api] session stream listener failed:', error instanceof Error ? error.message : error)
    }
  }
}

const sessionRepository = new SessionRepository({
  sessionsDir: config.storage.sessionsDir,
  legacyFilePath: config.storage.legacySessionsFile,
  messageStore: memoryStore,
  onSessionUpdated: async (session) => {
    if (!session?.sessionId || !sessionWorkspaces) {
      return
    }

    const item = await attachWorkspaceState(session)
    publishSessionStreamEvent(session.sessionId, {
      type: 'session.updated',
      item
    })
  },
  onSessionDeleted: async (sessionId) => {
    publishSessionStreamEvent(sessionId, {
      type: 'session.deleted',
      sessionId
    })
  },
  onMessageAppended: async ({ sessionId, session, message }) => {
    await tokenUsageStore.recordMessage({
      sessionId,
      message,
      aiId: session?.lastAiId
    })
  }
})
const skillRegistry = createSkillRegistry(config.skills)
const skillLibrary = createSkillLibrary({
  rootDir: config.skills.libraryDir
})
const sourceWorkspace = createWorkspace(config.workspace)
const mcpRegistry = createMcpRegistry({
  mcpConfig: config.mcp
})
const embeddingClientCache = new Map()
const EMBEDDING_CLIENT_CACHE_TTL_MS = 30000

function getCachedEmbeddingClient(cacheKey) {
  const cachedItem = embeddingClientCache.get(cacheKey)

  if (!cachedItem || cachedItem.expiresAt <= Date.now()) {
    embeddingClientCache.delete(cacheKey)
    return null
  }

  return cachedItem.client
}

function setCachedEmbeddingClient(cacheKey, client) {
  if (!cacheKey || !client) {
    return
  }

  embeddingClientCache.set(cacheKey, {
    client,
    expiresAt: Date.now() + EMBEDDING_CLIENT_CACHE_TTL_MS
  })
}

async function resolveEmbeddingConfigFromDatabase(embeddingAiId = '') {
  const normalizedEmbeddingAiId = normalizeTrimmedString(embeddingAiId)
  const embeddingConfigs = (await loadAiConfigs(config.ai)).filter((item) => item.type === 'embedding')
  const embeddingConfig = normalizedEmbeddingAiId
    ? embeddingConfigs.find((item) => item.aiId === normalizedEmbeddingAiId)
    : embeddingConfigs[0]

  if (!embeddingConfig) {
    return {
      aiId: '',
      name: '',
      baseURL: '',
      apiKey: '',
      model: '',
      provider: 'auto'
    }
  }

  return {
    aiId: embeddingConfig.aiId,
    name: embeddingConfig.name,
    baseURL: embeddingConfig.baseURL,
    apiKey: embeddingConfig.apiKey,
    model: embeddingConfig.defaultModel || embeddingConfig.models?.[0] || '',
    provider: 'auto'
  }
}

async function getEmbeddingClient(embeddingAiId = '') {
  const requestedCacheKey = normalizeTrimmedString(embeddingAiId) || '__default__'
  const requestedCachedClient = getCachedEmbeddingClient(requestedCacheKey)

  if (requestedCachedClient) {
    return requestedCachedClient
  }

  const embeddingDatabaseConfig = await resolveEmbeddingConfigFromDatabase(embeddingAiId)
  const cacheKey = embeddingDatabaseConfig.aiId || `default:${normalizeTrimmedString(embeddingAiId)}`
  const cachedClient = getCachedEmbeddingClient(cacheKey)

  if (cachedClient) {
    setCachedEmbeddingClient(requestedCacheKey, cachedClient)
    return cachedClient
  }

  const embeddingClient = createEmbeddingClient({
    aiId: embeddingDatabaseConfig.aiId,
    name: embeddingDatabaseConfig.name,
    baseURL: embeddingDatabaseConfig.baseURL,
    apiKey: embeddingDatabaseConfig.apiKey,
    model: embeddingDatabaseConfig.model,
    provider: embeddingDatabaseConfig.provider,
    dimension: config.rag.embeddingDimension,
    chunkMaxChars: embeddingDatabaseConfig.chunkMaxChars,
    chunkOverlapChars: embeddingDatabaseConfig.chunkOverlapChars,
    timeoutMs: config.rag.embeddingTimeoutMs,
    onUsage: async ({ aiId, model, usage, provider }) => {
      await tokenUsageStore.recordEmbeddingUsage({
        aiId,
        model,
        usage,
        source: provider
      })
    }
  })

  if (embeddingDatabaseConfig.aiId) {
    setCachedEmbeddingClient(cacheKey, embeddingClient)
    setCachedEmbeddingClient(requestedCacheKey, embeddingClient)
  }

  return embeddingClient
}

const ragStore = createRagStore(config.rag, {
  resolveEmbeddingProvider: getEmbeddingClient
})
try {
  await mcpRegistry.initialize()
  auditSystemAction('', 'mcp_registry_initialized', {
    serverCount: mcpRegistry.getServerSummaries().length
  })
} catch (error) {
  auditLogger.logEvent({
    event: 'error',
    scope: 'mcp_registry_initialize',
    message: error instanceof Error ? error.message : String(error || '')
  })
  console.warn('[agent-api] failed to initialize MCP registry:', error instanceof Error ? error.message : error)
}
if (config.rag.enabled) {
  try {
    await ragStore.initialize()
    auditSystemAction('', 'rag_initialized', {
      source: 'startup'
    })
  } catch (error) {
    auditLogger.logEvent({
      event: 'error',
      scope: 'rag_initialize_startup',
      message: error instanceof Error ? error.message : String(error || '')
    })
    console.warn('[agent-api] failed to initialize RAG store:', error instanceof Error ? error.message : error)
  }
}
sessionWorkspaces = createSessionWorkspacesRepository({
  baseDir: config.storage.sessionWorkspacesDir,
  sourceWorkspace,
  writeMode: config.workspace.writeMode,
  ignoredRootDirs: [
    config.storage.dataDir,
    config.storage.sessionArtifactsDir,
    config.storage.sessionWorkspacesDir
  ]
})
const toolRunner = createToolRunner({
  baseWorkspace: sourceWorkspace,
  resolveWorkspace: (sessionId) => sessionWorkspaces.resolveWorkspace(sessionId),
  workspaceConfig: config.workspace,
  runtimeConfig: config.runtime,
  externalToolProviders: [
    () => mcpRegistry.getGatewayToolDefinitions()
  ]
})

const agentRunner = createAgentRunner({
  sessionRepository,
  aiRuntimeConfig: config.ai,
  getAiConfigById,
  resolveModel,
  loadAiConfigs,
  publishSessionEvent: (sessionId, event) => {
    publishSessionStreamEvent(sessionId, event)
  },
  skillRegistry,
  sessionWorkspaces,
  runtimeConfig: config.runtime,
  workspaceConfig: config.workspace,
  toolRunner,
  ragStore,
  memoryStore,
  auditLogger
})

function setBaseHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function sendJson(response, statusCode, payload) {
  setBaseHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function sendEmpty(response, statusCode = 204) {
  setBaseHeaders(response)
  response.statusCode = statusCode
  response.end()
}

function getWorkspacePreviewContentType(filePath) {
  const extension = extname(String(filePath || '').toLowerCase())
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
  }

  return contentTypes[extension] || 'application/octet-stream'
}

function sendWorkspacePreviewFile(response, item) {
  setBaseHeaders(response)
  response.statusCode = 200
  response.setHeader('Content-Type', getWorkspacePreviewContentType(item?.path))
  response.setHeader('Content-Length', Buffer.byteLength(item?.buffer || Buffer.alloc(0)))
  response.setHeader('Content-Security-Policy', [
    "default-src 'self' data: blob:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'"
  ].join('; '))
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Content-Disposition', 'inline')
  response.end(item?.buffer || Buffer.alloc(0))
}

function sendSseHeaders(response) {
  setBaseHeaders(response)
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Connection', 'keep-alive')
  response.setHeader('X-Accel-Buffering', 'no')
}

function sendSseEvent(response, eventName, payload) {
  const lines = []

  if (eventName) {
    lines.push(`event: ${eventName}`)
  }

  const serializedPayload = JSON.stringify(payload ?? {})

  for (const line of serializedPayload.split(/\r?\n/)) {
    lines.push(`data: ${line}`)
  }

  response.write(`${lines.join('\n')}\n\n`)
}

function normalizeAuditQuery(requestUrl) {
  return Object.fromEntries(
    [...requestUrl.searchParams.entries()].map(([key, value]) => [
      key,
      /token/i.test(key) ? '[redacted]' : String(value || '').slice(0, 500)
    ])
  )
}

function sanitizeAuditPath(pathname) {
  return String(pathname || '').replace(
    /^\/api\/agent\/preview\/[^/]+\/([^/]+)/,
    '/api/agent/preview/:token/$1'
  )
}

function resolveRequestSessionId(requestUrl) {
  const directSessionId = normalizeTrimmedString(requestUrl.searchParams.get('sessionId'))

  if (directSessionId) {
    return directSessionId
  }

  const pathname = normalizeTrimmedString(requestUrl.pathname)
  const sessionPathMatch = pathname.match(/^\/api\/agent\/sessions\/([^/]+)/)

  if (sessionPathMatch?.[1]) {
    return decodeURIComponent(sessionPathMatch[1])
  }

  const previewPathMatch = pathname.match(/^\/api\/agent\/preview\/[^/]+\/([^/]+)/)

  return previewPathMatch?.[1] ? decodeURIComponent(previewPathMatch[1]) : ''
}

function getClientIp(request) {
  const forwardedFor = normalizeTrimmedString(request.headers['x-forwarded-for'])

  if (forwardedFor) {
    return normalizeTrimmedString(forwardedFor.split(',')[0])
  }

  return normalizeTrimmedString(request.socket?.remoteAddress)
}

function attachApiAudit(request, response, requestUrl) {
  const method = normalizeTrimmedString(request.method).toUpperCase()

  if (method === 'OPTIONS') {
    return
  }

  const requestId = createId('req')
  const startedAtMs = Date.now()
  const auditContext = {
    requestId,
    sessionId: resolveRequestSessionId(requestUrl)
  }
  request.auditContext = auditContext
  response.setHeader('X-Request-Id', requestId)

  auditLogger.logEvent({
    sessionId: auditContext.sessionId,
    event: 'api_request',
    requestId,
    method,
    path: sanitizeAuditPath(requestUrl.pathname),
    query: normalizeAuditQuery(requestUrl),
    clientIp: getClientIp(request),
    userAgent: normalizeTrimmedString(request.headers['user-agent'])
  })

  response.once('finish', () => {
    auditLogger.logEvent({
      sessionId: auditContext.sessionId,
      event: 'api_response',
      requestId,
      method,
      path: sanitizeAuditPath(requestUrl.pathname),
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAtMs
    })
  })
}

function setRequestAuditSession(request, sessionId) {
  if (!request?.auditContext) {
    return
  }

  request.auditContext.sessionId = normalizeTrimmedString(sessionId)
}

function auditSystemAction(sessionId, action, payload = {}) {
  auditLogger.logEvent({
    sessionId,
    event: 'system_action',
    action,
    ...payload
  })
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    size += chunk.length

    if (size > 24 * 1024 * 1024) {
      throw new Error('Request body is too large.')
    }

    chunks.push(chunk)
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim()

  if (!rawBody) {
    return {}
  }

  return JSON.parse(rawBody)
}

async function readRequestBuffer(request, maxSizeBytes = 32 * 1024 * 1024) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    size += chunk.length

    if (size > maxSizeBytes) {
      throw new Error('Request body is too large.')
    }

    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

function parseMultipartContentDisposition(value) {
  const result = {}

  for (const part of String(value || '').split(';')) {
    const [rawKey, ...rawValueParts] = part.trim().split('=')
    const key = normalizeTrimmedString(rawKey).toLowerCase()
    const rawValue = rawValueParts.join('=').trim()

    if (!key || !rawValue) {
      continue
    }

    result[key] = rawValue.replace(/^"|"$/g, '')
  }

  return result
}

function decodeMultipartHeaderValue(value) {
  const normalizedValue = String(value || '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^utf-8''/i.test(normalizedValue)) {
    try {
      return decodeURIComponent(normalizedValue.slice(7))
    } catch {
      return normalizedValue.slice(7)
    }
  }

  try {
    return Buffer.from(normalizedValue, 'latin1').toString('utf8')
  } catch {
    return normalizedValue
  }
}

function parseMultipartBody(buffer, contentType) {
  const boundaryMatch = String(contentType || '').match(/boundary=([^;]+)/i)
  const boundary = boundaryMatch?.[1]?.replace(/^"|"$/g, '')

  if (!boundary) {
    throw new Error('Multipart boundary is missing.')
  }

  const boundaryText = `--${boundary}`
  const body = buffer.toString('binary')
  const parts = body.split(boundaryText)
  const fields = {}
  const files = []

  for (const rawPart of parts) {
    if (!rawPart || rawPart === '--\r\n' || rawPart === '--') {
      continue
    }

    const normalizedPart = rawPart.replace(/^\r\n/, '').replace(/\r\n$/, '')
    const headerEndIndex = normalizedPart.indexOf('\r\n\r\n')

    if (headerEndIndex < 0) {
      continue
    }

    const rawHeaders = normalizedPart.slice(0, headerEndIndex)
    const rawContent = normalizedPart.slice(headerEndIndex + 4).replace(/\r\n--$/, '')
    const headers = {}

    for (const headerLine of rawHeaders.split('\r\n')) {
      const separatorIndex = headerLine.indexOf(':')

      if (separatorIndex < 0) {
        continue
      }

      headers[headerLine.slice(0, separatorIndex).trim().toLowerCase()] = headerLine
        .slice(separatorIndex + 1)
        .trim()
    }

    const disposition = parseMultipartContentDisposition(headers['content-disposition'])
    const name = normalizeTrimmedString(disposition.name)

    if (!name) {
      continue
    }

    const contentBuffer = Buffer.from(rawContent, 'binary')

    if (disposition.filename) {
      files.push({
        fieldName: name,
        filename: decodeMultipartHeaderValue(disposition['filename*'] || disposition.filename),
        contentType: headers['content-type'] || '',
        buffer: contentBuffer
      })
      continue
    }

    fields[name] = contentBuffer.toString('utf8').trim()
  }

  return { fields, files }
}

async function extractRagUploadText(file) {
  const filename = normalizeTrimmedString(file?.filename)
  const extension = extname(filename).toLowerCase()
  const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.alloc(0)

  if (!buffer.length) {
    throw new Error('Uploaded file is empty.')
  }

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer })
    return String(result?.value || '').trim()
  }

  if (extension === '.txt' || extension === '.md' || extension === '.markdown') {
    return buffer.toString('utf8').trim()
  }

  throw new Error('Unsupported RAG file type. Supported types: .txt, .md, .docx.')
}

function matchSessionDetailPath(pathname) {
  const match = pathname.match(/^\/api\/agent\/sessions\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function matchSessionFileContentPath(pathname) {
  const match = pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/file-content$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function matchSessionPreviewTokenPath(pathname) {
  const match = pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/preview-token$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function matchWorkspacePreviewPath(pathname) {
  const match = pathname.match(/^\/api\/agent\/preview\/([^/]+)\/([^/]+)\/(.+)$/)

  if (!match?.[1] || !match?.[2] || !match?.[3]) {
    return null
  }

  return {
    token: decodeURIComponent(match[1]),
    sessionId: decodeURIComponent(match[2]),
    filePath: decodeURIComponent(match[3])
  }
}

function matchSessionCancelPath(pathname) {
  const match = pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/cancel$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function matchSessionStreamPath(pathname) {
  const match = pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/stream$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function matchRagDocumentPath(pathname) {
  const match = pathname.match(/^\/api\/agent\/rag\/documents\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function matchAiConfigPath(pathname) {
  const match = pathname.match(/^\/api\/ai\/configs\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function getAuthorizedUser(request) {
  const token = readBearerToken(request.headers)
  return verifyAuthToken(token, config.auth.secret, {
    expectedType: 'access'
  })
}

function requireAuth(request, response) {
  const authPayload = getAuthorizedUser(request)

  if (!authPayload) {
    sendJson(response, 401, {
      message: 'Authentication required.'
    })
    return null
  }

  return authPayload
}

function createWorkspacePreviewToken(sessionId, username) {
  return createAuthToken({
    username: normalizeTrimmedString(username) || 'preview',
    secret: config.auth.secret,
    ttlMs: WORKSPACE_PREVIEW_TOKEN_TTL_MS,
    type: WORKSPACE_PREVIEW_TOKEN_TYPE,
    extraPayload: {
      sid: normalizeTrimmedString(sessionId)
    }
  })
}

function verifyWorkspacePreviewToken(token, sessionId) {
  const payload = verifyAuthToken(token, config.auth.secret, {
    expectedType: WORKSPACE_PREVIEW_TOKEN_TYPE
  })

  if (!payload) {
    return null
  }

  return normalizeTrimmedString(payload.sid) === normalizeTrimmedString(sessionId) ? payload : null
}

function validateLoginPayload(payload) {
  const username = normalizeTrimmedString(payload?.username)
  const password = String(payload?.password ?? '')

  if (!username || !password) {
    return {
      ok: false,
      message: 'Username and password are required.'
    }
  }

  return {
    ok: true,
    username
  }
}

const CODING_SKILL_HINT_PATTERNS = [
  /([A-Za-z0-9_./-]+\.(html|css|js|ts|tsx|jsx|vue|json|md|txt))/i,
  /\b(html|css|javascript|typescript|js|ts|vue|react|node|sql|api|bug|debug|build|compile|patch|diff|command|git|npm)\b/i,
  /写一个页面|写个页面|写一个网页|写个网页|写一个界面|写个界面|写一个组件|写个组件|写一个脚本|写个脚本|写代码|改代码|生成代码|创建页面|新建页面|创建组件|新建组件|前端|后端|项目|工作区|代码库|样式|脚本/,
  /写代码|改代码|生成代码|创建页面|新建页面|创建组件|修改文件|读取文件|搜索文件|报错|调试|修复|构建|运行命令|接口|前端|后端|项目|工作区|代码库|样式|脚本|组件/
]

function looksLikeCodingSkillRequest(message) {
  const normalizedMessage = normalizeTrimmedString(message)

  if (!normalizedMessage) {
    return false
  }

  if (
    /写代码|改代码|生成代码|创建代码|写一个页面|写个页面|写一个网页|写个网页|新建页面|创建页面|做一个页面|做个页面|做一个界面|做个界面|写一个界面|写个界面|创建界面|生成页面|生成界面|创建组件|新建组件|写一个组件|写个组件|写一个脚本|写个脚本|仿真时钟|时钟界面|前端|后端|项目|工作区|代码库|样式|脚本|组件|修复|调试|构建|接口|页面|界面/.test(normalizedMessage)
    || /(?:写|创建|生成|做|实现|修改|修复|调试|优化|重构)[\s\S]{0,40}(?:页面|网页|界面|组件|脚本|文件|代码|html|css|javascript|js|vue|react|python|py|时钟|表单|按钮|样式)/i.test(normalizedMessage)
  ) {
    return true
  }

  return CODING_SKILL_HINT_PATTERNS.some((pattern) => pattern.test(normalizedMessage))
}

function looksLikeFrontendSkillRequest(message) {
  const normalizedMessage = normalizeTrimmedString(message)

  if (!normalizedMessage) {
    return false
  }

  return (
    /页面|界面|组件|样式|布局|按钮|表单|弹窗|代码块|响应式|移动端|桌面端|前端|导航|侧边栏|会话区|卡片|溢出|遮挡|错位/.test(normalizedMessage)
    || /\b(ui|ux|frontend|front-end|page|webpage|component|layout|style|css|html|vue|react|button|modal|form|responsive|mobile|desktop|overflow)\b/i.test(normalizedMessage)
  )
}

function createAuthTokenPair(username) {
  const normalizedUsername = normalizeTrimmedString(username)
  const accessToken = createAuthToken({
    username: normalizedUsername,
    secret: config.auth.secret,
    ttlMs: config.auth.accessTokenTtlMs,
    type: 'access'
  })
  const refreshToken = createAuthToken({
    username: normalizedUsername,
    secret: config.auth.secret,
    ttlMs: config.auth.refreshTokenTtlMs,
    type: 'refresh'
  })

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: Math.floor(config.auth.accessTokenTtlMs / 1000),
    refresh_expires_in: Math.floor(config.auth.refreshTokenTtlMs / 1000)
  }
}

function looksLikeFrontendQualityRequest(message) {
  const normalizedMessage = normalizeTrimmedString(message)

  return Boolean(
    normalizedMessage
    && /页面|界面|组件|样式|布局|按钮|表单|弹窗|代码块|响应式|移动端|桌面端|前端|导航|侧边栏|会话区|卡片|溢出|遮挡|错位|时钟/.test(normalizedMessage)
  )
}

function compactSkillList(skills = []) {
  const seen = new Set()
  const normalizedSkills = []

  for (const skill of Array.isArray(skills) ? skills : []) {
    const skillId = normalizeTrimmedString(skill?.skillId)

    if (!skill || !skillId || seen.has(skillId)) {
      continue
    }

    seen.add(skillId)
    normalizedSkills.push(skill)
  }

  return normalizedSkills
}

function looksLikeLarkChatInfoRequest(message) {
  const normalizedMessage = normalizeTrimmedString(message)

  if (!normalizedMessage) {
    return false
  }

  return /^(获取|查看|查询|列出|刷新).{0,8}(飞书)?群聊(信息|列表)?$/i.test(normalizedMessage)
    || /^(飞书)?群聊(信息|列表)$/i.test(normalizedMessage)
}

function normalizeSkillIdArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(
    value
      .map((item) => normalizeTrimmedString(item))
      .filter(Boolean)
  )]
}

function normalizeConversationAttachments(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      const name = normalizeTrimmedString(item?.name) || `attachment-${index + 1}.txt`
      const type = normalizeTrimmedString(item?.type)
      const content = String(item?.content ?? '')
      const sizeBytes = Number(item?.sizeBytes)

      if (!content.trim()) {
        return null
      }

      return {
        name,
        type,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0
          ? Math.round(sizeBytes)
          : Buffer.byteLength(content, 'utf8'),
        content
      }
    })
    .filter(Boolean)
}

function resolveSkillsForMessage(requestedSkillIds, message) {
  const explicitSkills = normalizeSkillIdArray(requestedSkillIds)
    .map((skillId) => skillRegistry.getSkillById(skillId))
    .filter(Boolean)

  if (explicitSkills.length) {
    const explicitSkillIds = new Set(explicitSkills.map((item) => normalizeTrimmedString(item?.skillId)))

    if (explicitSkillIds.has('coding_agent')) {
      return compactSkillList([
        ...explicitSkills,
        skillRegistry.getSkillById('code_quality'),
        (looksLikeFrontendSkillRequest(message) || looksLikeFrontendQualityRequest(message))
          ? skillRegistry.getSkillById('frontend_quality')
          : null
      ].filter(Boolean))
    }

    return explicitSkills
  }

  if (looksLikeCodingSkillRequest(message)) {
    return compactSkillList([
      skillRegistry.getSkillById('coding_agent')
      || skillRegistry.resolveSkill(''),
      skillRegistry.getSkillById('code_quality'),
      (looksLikeFrontendSkillRequest(message) || looksLikeFrontendQualityRequest(message))
        ? skillRegistry.getSkillById('frontend_quality')
        : null
    ].filter(Boolean))
  }

  return [
    skillRegistry.getSkillById('general_chat')
    || skillRegistry.resolveSkill('')
  ].filter(Boolean)
}

async function trySharedAuthLogin(payload) {
  const baseUrl = normalizeTrimmedString(config.auth.sharedAuthBaseUrl)
  const loginPath = normalizeTrimmedString(config.auth.sharedAuthLoginPath) || '/api/login'

  if (!baseUrl) {
    return null
  }

  const sharedLoginUrl = `${baseUrl}${loginPath.startsWith('/') ? loginPath : `/${loginPath}`}`

  if (sharedLoginUrl === `http://${config.host}:${config.port}${loginPath.startsWith('/') ? loginPath : `/${loginPath}`}`) {
    return null
  }

  const response = await fetch(sharedLoginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.auth.sharedAuthTimeoutMs)
  })

  const rawBody = await response.text()
  let body = null

  try {
    body = rawBody ? JSON.parse(rawBody) : null
  } catch {
    body = null
  }

  if (!response.ok) {
    return {
      ok: false,
      statusCode: response.status,
      message: normalizeTrimmedString(body?.message)
        || normalizeTrimmedString(rawBody)
        || 'Shared login failed.'
    }
  }

  return {
    ok: true,
    body: {
      user: body?.user && typeof body.user === 'object'
        ? body.user
        : {
            username: normalizeTrimmedString(payload?.username)
          }
    }
  }
}

async function handleLogin(request, response) {
  const payload = await readJsonBody(request)
  const validation = validateLoginPayload(payload)

  if (!validation.ok) {
    auditLogger.logEvent({
      event: 'auth_failure',
      requestId: request.auditContext?.requestId,
      reason: 'invalid_payload'
    })
    sendJson(response, 401, {
      message: validation.message
    })
    return
  }

  const sharedLogin = await trySharedAuthLogin(payload)

  if (sharedLogin?.ok) {
    const sharedUsername = normalizeTrimmedString(sharedLogin.body?.user?.username || validation.username)
    const tokenPair = createAuthTokenPair(sharedUsername)

    auditLogger.logEvent({
      event: 'auth_success',
      requestId: request.auditContext?.requestId,
      provider: 'shared',
      username: sharedUsername
    })
    sendJson(response, 200, {
      ...tokenPair,
      user: {
        username: sharedUsername
      }
    })
    return
  }

  auditLogger.logEvent({
    event: 'auth_failure',
    requestId: request.auditContext?.requestId,
    provider: 'shared',
    username: validation.username,
    statusCode: sharedLogin?.statusCode || 502
  })
  sendJson(response, sharedLogin?.statusCode === 401 ? 401 : 502, {
    message: sharedLogin?.message || 'Shared login service is not configured.'
  })
}

async function handleRefreshAuthToken(request, response) {
  const payload = await readJsonBody(request)
  const refreshToken = normalizeTrimmedString(
    payload?.refreshToken
    || payload?.refresh_token
    || readBearerToken(request.headers)
  )

  if (!refreshToken) {
    auditLogger.logEvent({
      event: 'auth_failure',
      requestId: request.auditContext?.requestId,
      reason: 'missing_refresh_token'
    })
    sendJson(response, 401, {
      message: 'Refresh token is required.'
    })
    return
  }

  const refreshPayload = verifyAuthToken(refreshToken, config.auth.secret, {
    expectedType: 'refresh'
  })

  if (!refreshPayload?.sub) {
    auditLogger.logEvent({
      event: 'auth_failure',
      requestId: request.auditContext?.requestId,
      reason: 'invalid_refresh_token'
    })
    sendJson(response, 401, {
      message: 'Invalid or expired refresh token.'
    })
    return
  }

  const username = normalizeTrimmedString(refreshPayload.sub)
  const tokenPair = createAuthTokenPair(username)

  auditLogger.logEvent({
    event: 'auth_refresh',
    requestId: request.auditContext?.requestId,
    username
  })

  sendJson(response, 200, {
    ...tokenPair,
    user: {
      username
    }
  })
}

async function handleListAiConfigs(requestUrl, response) {
  const requestedType = normalizeTrimmedString(requestUrl.searchParams.get('type')).toLowerCase()
  const configs = await loadAiConfigs(config.ai)
  const filteredConfigs = requestedType
    ? configs.filter((item) => String(item.type || 'ai').toLowerCase() === requestedType)
    : configs
  const items = filteredConfigs.map((item) => toPublicAiConfig(item))

  sendJson(response, 200, { items })
}

async function handleCreateAiConfig(request, response) {
  try {
    const body = await readJsonBody(request)
    const result = await insertAiConfig({
      name: body?.name,
      aiVersions: body?.aiVersions,
      aiBaseUrl: body?.aiBaseUrl,
      apiKey: body?.apiKey,
      type: body?.type
    })

    auditSystemAction('', 'ai_config_created', {
      requestId: request.auditContext?.requestId,
      aiId: result?.aiId,
      name: result?.name,
      type: result?.type || 'ai',
      hasApiKey: Boolean(body?.apiKey)
    })
    sendJson(response, 201, { item: result })
  } catch (error) {
    auditLogger.logEvent({
      event: 'error',
      requestId: request.auditContext?.requestId,
      scope: 'ai_config_create',
      message: error instanceof Error ? error.message : String(error || '')
    })
    sendJson(response, 400, {
      message: error instanceof Error ? error.message : 'Create AI config failed.'
    })
  }
}

async function handleUpdateAiConfig(request, response, aiId) {
  try {
    const body = await readJsonBody(request)
    const result = await updateAiConfig(aiId, {
      name: body?.name,
      aiVersions: body?.aiVersions,
      aiBaseUrl: body?.aiBaseUrl,
      chunkMaxChars: body?.chunkMaxChars,
      chunkOverlapChars: body?.chunkOverlapChars
    })

    embeddingClientCache.clear()
    auditSystemAction('', 'ai_config_updated', {
      requestId: request.auditContext?.requestId,
      aiId,
      name: result?.name,
      type: result?.type || 'ai'
    })
    sendJson(response, 200, { item: result })
  } catch (error) {
    auditLogger.logEvent({
      event: 'error',
      requestId: request.auditContext?.requestId,
      scope: 'ai_config_update',
      aiId,
      message: error instanceof Error ? error.message : String(error || '')
    })
    sendJson(response, 400, {
      message: error instanceof Error ? error.message : 'Update AI config failed.'
    })
  }
}

async function attachConversationMemoryState(item) {
  if (!item?.sessionId) {
    return item
  }

  if (!memoryStore || typeof memoryStore.readConversationMemory !== 'function') {
    return item
  }

  try {
    const memoryState = await memoryStore.readConversationMemory(item.sessionId, {
      maxChars: config.ai.contextMemoryMaxChars
    })

    if (!memoryState?.summary && !memoryState?.updatedAt) {
      return item
    }

    return {
      ...item,
      memorySummary: memoryState.summary || item.memorySummary || '',
      memoryUpdatedAt: memoryState.updatedAt || item.memoryUpdatedAt || null,
      memoryCompressedThroughMessageId: memoryState.compressedThroughMessageId || item.memoryCompressedThroughMessageId || '',
      memoryMessageCount: 0
    }
  } catch (error) {
    console.warn('[agent-api] failed to attach conversation memory:', error instanceof Error ? error.message : error)
    return item
  }
}

async function attachWorkspaceState(item) {
  if (!item?.sessionId) {
    return item
  }

  const itemWithMemory = await attachConversationMemoryState(item)
  const trackedWorkspaceFiles = Array.isArray(itemWithMemory.workspaceFiles) ? itemWithMemory.workspaceFiles : []

  return {
    ...itemWithMemory,
    workspaceFolder: sessionWorkspaces.getWorkspaceFolderLabel(item.sessionId),
    workspaceFiles: await sessionWorkspaces.listWorkspaceFiles(item.sessionId, trackedWorkspaceFiles)
  }
}

async function handleListSessions(response) {
  const items = await Promise.all((await sessionRepository.listSummaries()).map((item) => attachConversationMemoryState(item)))
  sendJson(response, 200, { items })
}

async function handleGetTokenUsageAnalytics(response) {
  const aiConfigs = await loadAiConfigs(config.ai)
  sendJson(response, 200, await tokenUsageStore.getAnalytics(aiConfigs))
}

function normalizeAuditSessionFileName(value) {
  const normalizedValue = normalizeTrimmedString(value)

  if (!normalizedValue) {
    return ''
  }

  return normalizedValue.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function parseAuditEventLine(line) {
  const normalizedLine = String(line || '').trim()

  if (!normalizedLine) {
    return null
  }

  try {
    return JSON.parse(normalizedLine)
  } catch {
    return {
      ts: '',
      event: 'parse_error',
      message: 'Audit event line is not valid JSON.',
      raw: normalizedLine.slice(0, 500)
    }
  }
}

async function readAuditEvents(sessionId) {
  const safeSessionId = normalizeAuditSessionFileName(sessionId)

  if (!safeSessionId) {
    throw new Error('Session id is required.')
  }

  const filePath = join(config.storage.auditDir, `${safeSessionId}.jsonl`)

  try {
    const content = await readFile(filePath, 'utf8')

    return content
      .split(/\r?\n/)
      .map((line) => parseAuditEventLine(line))
      .filter(Boolean)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function deleteAuditSessionFile(sessionId) {
  const safeSessionId = normalizeAuditSessionFileName(sessionId)

  if (!safeSessionId) {
    return false
  }

  const filePath = join(config.storage.auditDir, `${safeSessionId}.jsonl`)

  try {
    await rm(filePath, { force: true })
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

async function handleListAuditSessions(response) {
  let entries = []

  try {
    entries = await readdir(config.storage.auditDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendJson(response, 200, { items: [] })
      return
    }

    throw error
  }

  const items = []
  const knownSessionIds = new Set((await sessionRepository.listSummaries()).map((item) => item.sessionId))

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue
    }

    const auditSessionId = basename(entry.name, '.jsonl')
    const filePath = join(config.storage.auditDir, entry.name)

    if (!knownSessionIds.has(auditSessionId)) {
      await rm(filePath, { force: true })
      continue
    }

    const [fileStat, events] = await Promise.all([
      stat(filePath),
      readAuditEvents(auditSessionId)
    ])
    const lastEvent = [...events].reverse().find(Boolean) || null

    items.push({
      sessionId: auditSessionId,
      eventCount: events.length,
      fileSizeBytes: fileStat.size,
      updatedAt: new Date(fileStat.mtimeMs).toISOString(),
      lastEvent: lastEvent?.event || '',
      lastEventAt: lastEvent?.ts || lastEvent?.time || ''
    })
  }

  items.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))

  sendJson(response, 200, { items })
}

async function handleListAuditEvents(response, requestUrl) {
  const sessionId = normalizeTrimmedString(requestUrl.searchParams.get('sessionId'))
  const eventFilter = normalizeTrimmedString(requestUrl.searchParams.get('event'))
  const limit = Math.max(
    1,
    Math.min(1000, Number.parseInt(requestUrl.searchParams.get('limit') || '300', 10) || 300)
  )

  if (!sessionId) {
    sendJson(response, 400, {
      message: 'Session id is required.'
    })
    return
  }

  const events = await readAuditEvents(sessionId)
  const filteredEvents = eventFilter
    ? events.filter((item) => normalizeTrimmedString(item?.event) === eventFilter)
    : events
  const items = filteredEvents.slice(-limit)
  const eventTypes = [...new Set(events.map((item) => normalizeTrimmedString(item?.event)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))

  sendJson(response, 200, {
    sessionId: normalizeAuditSessionFileName(sessionId),
    total: filteredEvents.length,
    returned: items.length,
    eventTypes,
    items
  })
}

async function handleGetUserMemoryProfile(response) {
  const profile = await memoryStore.readUserProfile()
  const status = await memoryStore.getStatus()

  sendJson(response, 200, {
    profile,
    status
  })
}

async function handleListSkills(response) {
  sendJson(response, 200, {
    items: skillRegistry.listSkills()
  })
}

async function handleListSkillFiles(response) {
  sendJson(response, 200, {
    items: skillLibrary.listSkillFiles()
  })
}

async function handleGetSkillFileDetail(response, requestUrl) {
  const skillPath = normalizeTrimmedString(requestUrl.searchParams.get('path'))

  if (!skillPath) {
    sendJson(response, 400, {
      message: 'Skill path is required.'
    })
    return
  }

  const item = skillLibrary.getSkillFileDetail(skillPath)

  if (!item) {
    sendJson(response, 404, {
      message: 'Skill file not found.'
    })
    return
  }

  sendJson(response, 200, { item })
}

async function handleGetCapabilities(response) {
  sendJson(response, 200, {
    skills: skillRegistry.listSkills(),
    tools: toolRunner.getToolCatalog(),
    mcpServers: mcpRegistry.getServerSummaries(),
    rag: await ragStore.getStatus(),
    contextMemory: {
      enabled: Boolean(config.ai.contextMemoryEnabled),
      countUnit: 'turn',
      thresholdTurns: config.ai.contextMemoryThreshold,
      keepTurns: config.ai.contextMemoryKeepMessages,
      minBatchTurns: config.ai.contextMemoryMinBatchMessages,
      thresholdMessages: config.ai.contextMemoryThreshold,
      keepMessages: config.ai.contextMemoryKeepMessages,
      minBatchMessages: config.ai.contextMemoryMinBatchMessages,
      maxSummaryChars: config.ai.contextMemoryMaxChars
    }
  })
}

async function handleGetRagStatus(response) {
  sendJson(response, 200, await ragStore.getStatus())
}

async function handleListRagCollections(response) {
  sendJson(response, 200, {
    items: await ragStore.listCollections()
  })
}

async function handleCreateRagCollection(request, response) {
  const payload = await readJsonBody(request)
  const item = await ragStore.createCollection({
    name: normalizeTrimmedString(payload?.name),
    description: normalizeTrimmedString(payload?.description),
    metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
  })

  auditSystemAction('', 'rag_collection_created', {
    requestId: request.auditContext?.requestId,
    collectionId: item?.collectionId,
    name: item?.name
  })
  sendJson(response, 201, { item })
}

async function handleInitializeRag(request, response) {
  try {
    const result = await ragStore.initialize()
    auditSystemAction('', 'rag_initialized', {
      requestId: request.auditContext?.requestId,
      ready: Boolean(result?.ready)
    })
    sendJson(response, 200, result)
  } catch (error) {
    auditLogger.logEvent({
      event: 'error',
      requestId: request.auditContext?.requestId,
      scope: 'rag_initialize',
      message: error instanceof Error ? error.message : String(error || '')
    })
    sendJson(response, 500, {
      enabled: config.rag.enabled,
      ready: false,
      message: error instanceof Error ? error.message : 'Failed to initialize RAG store.'
    })
  }
}

async function handleListRagDocuments(response, requestUrl) {
  const limit = Number.parseInt(requestUrl.searchParams.get('limit') || '', 10)
  const collectionId = normalizeTrimmedString(requestUrl.searchParams.get('collectionId'))
  sendJson(response, 200, {
    items: await ragStore.listDocuments({ collectionId, limit })
  })
}

async function handleCreateRagDocument(request, response) {
  const payload = await readJsonBody(request)
  const title = normalizeTrimmedString(payload?.title)
  const content = String(payload?.content || '').trim()

  if (!content) {
    sendJson(response, 400, {
      message: 'RAG document content is required.'
    })
    return
  }

  const item = await ragStore.ingestTextDocument({
    documentId: normalizeTrimmedString(payload?.documentId),
    collectionId: normalizeTrimmedString(payload?.collectionId),
    title: title || 'Untitled document',
    content,
    sourceType: normalizeTrimmedString(payload?.sourceType) || 'manual',
    sourcePath: normalizeTrimmedString(payload?.sourcePath),
    metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    embeddingAiId: normalizeTrimmedString(payload?.embeddingAiId)
  })

  auditSystemAction('', 'rag_document_created', {
    requestId: request.auditContext?.requestId,
    documentId: item?.documentId,
    collectionId: item?.collectionId,
    title: item?.title,
    contentLength: content.length,
    sourceType: item?.sourceType || normalizeTrimmedString(payload?.sourceType) || 'manual'
  })
  sendJson(response, 201, { item })
}

async function handleUploadRagDocument(request, response) {
  const contentType = String(request.headers['content-type'] || '')

  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    sendJson(response, 400, {
      message: 'Expected multipart/form-data upload.'
    })
    return
  }

  const { fields, files } = parseMultipartBody(await readRequestBuffer(request), contentType)
  const uploadFiles = files.filter((file) => file.fieldName === 'file' || file.fieldName === 'files')
  const collectionId = normalizeTrimmedString(fields.collectionId)
  const embeddingAiId = normalizeTrimmedString(fields.embeddingAiId)

  if (!uploadFiles.length) {
    sendJson(response, 400, {
      message: 'RAG upload file is required.'
    })
    return
  }

  const items = []

  for (const file of uploadFiles) {
    const content = await extractRagUploadText(file)

    if (!content) {
      throw new Error(`No readable text found in ${file.filename}.`)
    }

    const title = normalizeTrimmedString(fields.title) || normalizeTrimmedString(file.filename) || 'Uploaded document'
    const item = await ragStore.ingestTextDocument({
      collectionId,
      title,
      content,
      sourceType: 'upload',
      sourcePath: normalizeTrimmedString(file.filename),
      metadata: {
        filename: normalizeTrimmedString(file.filename),
        contentType: normalizeTrimmedString(file.contentType),
        sizeBytes: file.buffer.length
      },
      embeddingAiId
    })

    items.push(item)
  }

  auditSystemAction('', 'rag_document_uploaded', {
    requestId: request.auditContext?.requestId,
    collectionId,
    embeddingAiId,
    fileCount: uploadFiles.length,
    documentIds: items.map((item) => item?.documentId).filter(Boolean),
    totalSizeBytes: uploadFiles.reduce((sum, file) => sum + file.buffer.length, 0)
  })
  sendJson(response, 201, { items })
}

async function handleSearchRag(request, response, requestUrl) {
  const query = normalizeTrimmedString(requestUrl.searchParams.get('q'))
  const collectionId = normalizeTrimmedString(requestUrl.searchParams.get('collectionId'))
  const embeddingAiId = normalizeTrimmedString(requestUrl.searchParams.get('embeddingAiId'))
  const limit = Number.parseInt(requestUrl.searchParams.get('limit') || '', 10)

  if (!query) {
    sendJson(response, 400, {
      message: 'RAG search query is required.'
    })
    return
  }

  const items = await ragStore.search({ query, collectionId, limit, embeddingAiId })
  auditLogger.logEvent({
    event: 'rag_search',
    requestId: request.auditContext?.requestId,
    source: 'api',
    collectionId,
    embeddingAiId,
    queryPreview: query.slice(0, 500),
    hitCount: items.length
  })
  sendJson(response, 200, {
    items
  })
}

async function handleRebuildRagEmbeddings(request, response) {
  const payload = await readJsonBody(request)
  const result = await ragStore.rebuildEmbeddings({
    collectionId: normalizeTrimmedString(payload?.collectionId),
    limit: Number.parseInt(payload?.limit || '', 10),
    embeddingAiId: normalizeTrimmedString(payload?.embeddingAiId)
  })

  auditSystemAction('', 'rag_embeddings_rebuilt', {
    requestId: request.auditContext?.requestId,
    collectionId: normalizeTrimmedString(payload?.collectionId),
    embeddingAiId: normalizeTrimmedString(payload?.embeddingAiId),
    limit: Number.parseInt(payload?.limit || '', 10),
    result
  })
  sendJson(response, 200, result)
}

async function handleDeleteRagDocument(request, response, documentId) {
  const result = await ragStore.deleteDocument(documentId)
  auditSystemAction('', 'rag_document_deleted', {
    requestId: request.auditContext?.requestId,
    documentId,
    result
  })
  sendJson(response, 200, result)
}

function parseJsonMaybe(value) {
  const normalized = String(value || '').trim()

  if (!normalized || (!normalized.startsWith('{') && !normalized.startsWith('['))) {
    return null
  }

  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function pickFirstString(item, keys) {
  for (const key of keys) {
    const value = item?.[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function collectLarkChats(value, chats = [], seen = new Set(), depth = 0) {
  if (depth > 8 || value == null) {
    return chats
  }

  if (typeof value === 'string') {
    const parsed = parseJsonMaybe(value)
    if (parsed) {
      collectLarkChats(parsed, chats, seen, depth + 1)
    }
    return chats
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectLarkChats(item, chats, seen, depth + 1)
    }
    return chats
  }

  if (typeof value !== 'object') {
    return chats
  }

  const chatId = pickFirstString(value, ['chat_id', 'chatId', 'open_chat_id', 'openChatId'])
  const name = pickFirstString(value, ['name', 'chat_name', 'chatName', 'title', 'topic'])

  if (chatId && !seen.has(chatId)) {
    seen.add(chatId)
    chats.push({
      chatId,
      name: name || chatId,
      description: pickFirstString(value, ['description', 'owner_id', 'ownerId']) || ''
    })
  }

  for (const nestedValue of Object.values(value)) {
    collectLarkChats(nestedValue, chats, seen, depth + 1)
  }

  return chats
}

function normalizeLarkChatListResult(toolExecution) {
  return collectLarkChats([
    toolExecution?.result?.structuredContent,
    toolExecution?.result?.raw,
    toolExecution?.result?.content,
    toolExecution?.result?.text,
    toolExecution?.message
  ])
}

async function listLarkChatsViaMcp({ sessionId = '' } = {}) {
  const larkChatListTools = mcpRegistry.getToolDefinitions()
    .filter((tool) => {
      const name = String(tool?.name || '').toLowerCase()
      return name.startsWith('mcp.lark.')
        && name.includes('chat')
        && (name.includes('list') || name.includes('get') || name.includes('search'))
    })
    .map((tool) => ({
      name: tool.name,
      run: tool.run,
      formatMessage: tool.formatMessage
    }))

  if (!larkChatListTools.length) {
    const error = new Error('Current Lark MCP has no chat list tool. Check IM permissions and AGENT_LARK_TOOLS.')
    error.statusCode = 501
    throw error
  }

  const argCandidates = [
    {},
    { page_size: 100 },
    { pageSize: 100 },
    { limit: 100 }
  ]
  let lastError = ''

  for (const tool of larkChatListTools) {
    for (const args of argCandidates) {
      try {
        const result = await tool.run(args, {})
        const toolExecution = {
          result,
          message: typeof tool.formatMessage === 'function'
            ? tool.formatMessage(result, args)
            : ''
        }
        const items = normalizeLarkChatListResult(toolExecution)

        return {
          items,
          tool: tool.name
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error || '')
      }
    }
  }

  throw new Error(lastError || 'Failed to read Feishu chat list.')
}

async function handleListLarkChats(response, requestUrl) {
  const sessionId = normalizeTrimmedString(requestUrl?.searchParams?.get('sessionId'))

  try {
    sendJson(response, 200, await listLarkChatsViaMcp({ sessionId }))
  } catch (error) {
    sendJson(response, error?.statusCode || 500, {
      message: error instanceof Error ? error.message : 'Failed to read Feishu chat list.'
    })
  }
}

function createLarkChatListAssistantContent({ items = [], tool = '' } = {}) {
  const payload = {
    type: 'lark_chat_list',
    tool,
    items: Array.isArray(items) ? items : []
  }

  return [
    ':::agent-lark-chat-list',
    JSON.stringify(payload),
    ':::'
  ].join('\n')
}

function resolveMcpToolPrefixes(serverIds = []) {
  const normalizedServerIds = normalizeSkillIdArray(serverIds)

  if (normalizedServerIds.includes(MCP_DISABLED_SELECTION)) {
    return [MCP_DISABLED_SELECTION]
  }

  if (!normalizedServerIds.length) {
    return []
  }

  if (normalizedServerIds.includes(MCP_ALL_SELECTION)) {
    return []
  }

  const selectedServerIds = new Set(normalizedServerIds)
  const prefixes = mcpRegistry.getServerSummaries()
    .filter((item) => selectedServerIds.has(item.serverId) && item.status === 'ready')
    .map((item) => normalizeTrimmedString(item.toolNamePrefix))
    .filter(Boolean)

  return prefixes.length ? prefixes : ['__no_selected_mcp_server__']
}

async function handleListAgentTools(response) {
  sendJson(response, 200, {
    items: listToolPreviewItems(toolRunner.getToolCatalog())
  })
}

async function handleGetAgentToolDetail(response, requestUrl) {
  const toolName = normalizeTrimmedString(requestUrl.searchParams.get('name'))

  if (!toolName) {
    sendJson(response, 400, {
      message: 'Tool name is required.'
    })
    return
  }

  const item = await getToolDetailItem(toolRunner.getToolCatalog(), toolName)

  if (!item) {
    sendJson(response, 404, {
      message: 'Tool not found.'
    })
    return
  }

  sendJson(response, 200, { item })
}

async function handleCreateSession(request, response) {
  const item = await sessionRepository.createSession()
  setRequestAuditSession(request, item.sessionId)
  await sessionWorkspaces.ensureSessionWorkspace(item.sessionId)
  const updatedItem = await sessionRepository.updateSession(item.sessionId, (session) => {
    session.workspaceFolder = sessionWorkspaces.getWorkspaceFolderLabel(item.sessionId)
    return session
  })
  auditSystemAction(item.sessionId, 'session_created', {
    requestId: request.auditContext?.requestId,
    workspaceFolder: updatedItem?.workspaceFolder || item.workspaceFolder
  })
  sendJson(response, 201, { item: await attachWorkspaceState(updatedItem || item) })
}

async function handleGetSession(response, sessionId) {
  const item = await sessionRepository.getSession(sessionId)

  if (!item) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  sendJson(response, 200, { item: await attachWorkspaceState(item) })
}

async function handleGetSessionFileContent(request, response, requestUrl, sessionId) {
  const filePath = normalizeTrimmedString(requestUrl.searchParams.get('path'))

  if (!filePath) {
    sendJson(response, 400, {
      message: 'File path is required.'
    })
    return
  }

  const session = await sessionRepository.getSession(sessionId)

  if (!session) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  const item = await sessionWorkspaces.readWorkspaceFile(
    sessionId,
    filePath,
    config.workspace.maxFileSizeBytes
  )

  auditLogger.logEvent({
    sessionId,
    event: 'workspace_read',
    requestId: request.auditContext?.requestId,
    source: 'api',
    path: item?.path || filePath,
    sizeBytes: item?.sizeBytes ?? null,
    truncated: Boolean(item?.truncated)
  })
  sendJson(response, 200, { item })
}

async function handleCreateWorkspacePreviewToken(request, response, sessionId) {
  const session = await sessionRepository.getSession(sessionId)

  if (!session) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  const authPayload = getAuthorizedUser(request)
  const token = createWorkspacePreviewToken(sessionId, authPayload?.sub)

  auditLogger.logEvent({
    sessionId,
    event: 'system_action',
    action: 'workspace_preview_token_issued',
    requestId: request.auditContext?.requestId,
    expiresInMs: WORKSPACE_PREVIEW_TOKEN_TTL_MS
  })

  sendJson(response, 200, {
    token,
    expiresIn: Math.floor(WORKSPACE_PREVIEW_TOKEN_TTL_MS / 1000)
  })
}

async function handleGetWorkspacePreviewFile(request, response, previewRequest) {
  const sessionId = normalizeTrimmedString(previewRequest?.sessionId)
  const filePath = normalizeTrimmedString(previewRequest?.filePath)

  if (!verifyWorkspacePreviewToken(previewRequest?.token, sessionId)) {
    sendJson(response, 401, {
      message: 'Workspace preview token is invalid or expired.'
    })
    return
  }

  const session = await sessionRepository.getSession(sessionId)

  if (!session) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  const item = await sessionWorkspaces.readWorkspaceFileBuffer(
    sessionId,
    filePath,
    config.workspace.maxFileSizeBytes
  )

  auditLogger.logEvent({
    sessionId,
    event: 'workspace_read',
    requestId: request.auditContext?.requestId,
    source: 'preview',
    path: item?.path || filePath,
    sizeBytes: item?.sizeBytes ?? null
  })
  sendWorkspacePreviewFile(response, item)
}

async function handleDeleteSession(request, response, sessionId) {
  const removed = await sessionRepository.deleteSession(sessionId)

  if (!removed) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  await sessionWorkspaces.deleteSessionWorkspace(sessionId)

  const auditDeletion = typeof auditLogger.deleteSessionAuditRecords === 'function'
    ? await auditLogger.deleteSessionAuditRecords(sessionId)
    : {
        ok: await deleteAuditSessionFile(sessionId),
        deletedQueuedCount: 0,
        deletedFile: true
      }

  setRequestAuditSession(request, '')
  auditSystemAction('', 'session_deleted', {
    requestId: request.auditContext?.requestId,
    deletedSessionId: sessionId,
    auditDeleted: Boolean(auditDeletion?.ok),
    deletedAuditQueuedCount: Number(auditDeletion?.deletedQueuedCount || 0)
  })

  sendEmpty(response, 204)
}

async function handleCancelTask(request, response, sessionId) {
  const item = await agentRunner.cancelTask(sessionId)

  if (!item) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  auditSystemAction(sessionId, 'task_cancel_requested', {
    requestId: request.auditContext?.requestId,
    taskId: item?.task?.taskId,
    status: item?.task?.status
  })
  sendJson(response, 202, { item: await attachWorkspaceState(item) })
}

async function handleSessionStream(request, response, sessionId) {
  const session = await sessionRepository.getSession(sessionId)

  if (!session) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  sendSseHeaders(response)
  sendSseEvent(response, 'session.updated', {
    item: await attachWorkspaceState(session)
  })

  const unsubscribe = subscribeToSessionStream(sessionId, (event) => {
    sendSseEvent(response, event.type || 'message', event)
  })
  const heartbeatTimer = setInterval(() => {
    try {
      response.write(': keep-alive\n\n')
    } catch {
      // connection cleanup is handled below
    }
  }, 15000)

  const cleanup = () => {
    clearInterval(heartbeatTimer)
    unsubscribe()
  }

  request.on('close', cleanup)
  response.on('close', cleanup)
}

async function handleChat(request, response) {
  const payload = await readJsonBody(request)
  const message = normalizeTrimmedString(payload?.message)
  const aiId = normalizeTrimmedString(payload?.aiId)
  const requestedModel = normalizeTrimmedString(payload?.model)
  const requestedSkillIds = normalizeSkillIdArray(
    Array.isArray(payload?.skillIds)
      ? payload.skillIds
      : [payload?.skillId]
  )
  const requestedMcpServerIds = normalizeSkillIdArray(payload?.mcpServerIds)
  const requestedMcpToolPrefixes = resolveMcpToolPrefixes(requestedMcpServerIds)
  const requestedRagCollectionIds = normalizeSkillIdArray(
    Array.isArray(payload?.ragCollectionIds)
      ? payload.ragCollectionIds
      : [payload?.ragCollectionId]
  )
  const requestedRagCollectionId = requestedRagCollectionIds[0] || ''
  const requestedEmbeddingAiId = normalizeTrimmedString(payload?.embeddingAiId)
  const requestedAttachments = normalizeConversationAttachments(payload?.attachments)
  if (requestedRagCollectionIds.length) {
    const selectedCollectionText = requestedRagCollectionIds.join(', ')
    requestedAttachments.push({
      name: 'selected-rag-knowledge-base.txt',
      type: 'text/plain',
      sizeBytes: Buffer.byteLength(selectedCollectionText, 'utf8'),
      content: [
        'Selected RAG knowledge base context for this Agent request.',
        `collectionIds: ${selectedCollectionText}`,
        requestedEmbeddingAiId ? `embeddingAiId: ${requestedEmbeddingAiId}` : '',
        'When RAG retrieval is enabled, use these collections as the retrieval scope.'
      ].filter(Boolean).join('\n')
    })
  }
  const activeSkills = resolveSkillsForMessage(requestedSkillIds, message)
  const primarySkill = activeSkills[0] || null

  if (!message) {
    sendJson(response, 400, {
      message: 'Message is required.'
    })
    return
  }

  const aiConfig = await getAiConfigById(config.ai, aiId)

  if (!aiConfig) {
    sendJson(response, 400, {
      message: 'The selected AI configuration was not found.'
    })
    return
  }

  const selectedModel = resolveModel(aiConfig, requestedModel)

  if (!selectedModel) {
    sendJson(response, 400, {
      message: 'The selected model is not available.'
    })
    return
  }

  let sessionId = normalizeTrimmedString(payload?.sessionId)
  let session = sessionId ? await sessionRepository.getSession(sessionId) : null
  let createdNewSession = false

  if (sessionId) {
    setRequestAuditSession(request, sessionId)
  }

  if (session && agentRunner.isTaskActive(session.sessionId)) {
    sendJson(response, 409, {
      message: 'The current session already has a running task.'
    })
    return
  }

  if (session?.task?.status && ['queued', 'pending', 'running', 'in_progress'].includes(session.task.status)) {
    sendJson(response, 409, {
      message: 'The current session is still processing the previous task.'
    })
    return
  }

  const pendingToolApproval = session?.pendingToolApproval?.status === 'pending'
    ? session.pendingToolApproval
    : null

  if (pendingToolApproval) {
    const approvalContext = pendingToolApproval.context && typeof pendingToolApproval.context === 'object'
      ? pendingToolApproval.context
      : {}
    const approvalSkillIds = normalizeSkillIdArray(
      Array.isArray(approvalContext.requestedSkillIds)
        ? approvalContext.requestedSkillIds
        : [approvalContext.requestedSkillId]
    )
    const approvalPrimarySkillId = approvalSkillIds[0] || primarySkill?.skillId || ''
    const preparedSession = await sessionRepository.prepareSessionForTask({
      sessionId,
      message,
      aiId: approvalContext.requestedAiId || aiConfig.aiId,
      model: approvalContext.requestedModel || selectedModel,
      skillId: approvalPrimarySkillId,
      skillIds: approvalSkillIds.length ? approvalSkillIds : activeSkills.map((item) => item.skillId)
    })

    auditLogger.logUserMessage({
      sessionId,
      content: message,
      aiId: approvalContext.requestedAiId || aiConfig.aiId,
      model: approvalContext.requestedModel || selectedModel,
      skillIds: approvalSkillIds.length ? approvalSkillIds : activeSkills.map((item) => item.skillId),
      mcpServerIds: Array.isArray(approvalContext.requestedMcpServerIds)
        ? approvalContext.requestedMcpServerIds
        : requestedMcpServerIds,
      ragCollectionIds: Array.isArray(approvalContext.requestedRagCollectionIds)
        ? approvalContext.requestedRagCollectionIds
        : requestedRagCollectionIds,
      embeddingAiId: approvalContext.requestedEmbeddingAiId || requestedEmbeddingAiId,
      attachmentCount: requestedAttachments.length,
      createdNewSession: false,
      approvalId: pendingToolApproval.approvalId
    })

    if (isToolApprovalDenial(message)) {
      auditLogger.logEvent({
        sessionId,
        event: 'tool_approval_denied',
        approvalId: pendingToolApproval.approvalId,
        tool: pendingToolApproval.tool
      })
      await sessionRepository.appendAssistantMessage(sessionId, {
        content: `已取消待执行操作：${pendingToolApproval.tool}。`,
        model: approvalContext.requestedModel || selectedModel
      })
      const completedSession = await sessionRepository.updateSession(sessionId, (draftSession) => {
        const timestamp = new Date().toISOString()
        draftSession.pendingToolApproval = null
        draftSession.task = {
          ...draftSession.task,
          status: 'completed',
          summary: `已取消受保护工具 ${pendingToolApproval.tool}。`,
          completedAt: timestamp,
          updatedAt: timestamp
        }
        draftSession.updatedAt = timestamp
        return draftSession
      })

      sendJson(response, 200, {
        session: await attachWorkspaceState(completedSession || preparedSession)
      })
      return
    }

    if (!isToolApprovalConfirmation(message)) {
      await sessionRepository.appendAssistantMessage(sessionId, {
        content: `当前还有一个受保护操作等待确认：${pendingToolApproval.tool}。请回复“确认执行”继续，或回复“取消执行”放弃。`,
        model: approvalContext.requestedModel || selectedModel
      })
      const waitingSession = await sessionRepository.updateSession(sessionId, (draftSession) => {
        const timestamp = new Date().toISOString()
        draftSession.task = {
          ...draftSession.task,
          status: 'waiting_for_user',
          summary: `等待确认受保护工具 ${pendingToolApproval.tool}。`,
          completedAt: timestamp,
          updatedAt: timestamp
        }
        draftSession.updatedAt = timestamp
        return draftSession
      })

      sendJson(response, 200, {
        session: await attachWorkspaceState(waitingSession || preparedSession)
      })
      return
    }

    const approvedSession = await sessionRepository.updateSession(sessionId, (draftSession) => {
      const timestamp = new Date().toISOString()
      draftSession.pendingToolApproval = {
        ...pendingToolApproval,
        status: 'approved',
        approvedAt: timestamp
      }
      draftSession.task = {
        ...draftSession.task,
        status: 'queued',
        summary: `已确认，准备执行受保护工具 ${pendingToolApproval.tool}。`,
        completedAt: null,
        updatedAt: timestamp
      }
      draftSession.updatedAt = timestamp
      return draftSession
    })

    auditLogger.logEvent({
      sessionId,
      event: 'tool_approval_granted',
      approvalId: pendingToolApproval.approvalId,
      tool: pendingToolApproval.tool
    })

    void agentRunner.startTask({
      sessionId,
      requestedAiId: approvalContext.requestedAiId || aiConfig.aiId,
      requestedModel: approvalContext.requestedModel || selectedModel,
      requestedSkillId: approvalContext.requestedSkillId || approvalPrimarySkillId,
      requestedSkillIds: approvalSkillIds.length ? approvalSkillIds : activeSkills.map((item) => item.skillId),
      requestedManualSkillIds: Array.isArray(approvalContext.requestedManualSkillIds)
        ? approvalContext.requestedManualSkillIds
        : requestedSkillIds,
      requestedMcpServerIds: Array.isArray(approvalContext.requestedMcpServerIds)
        ? approvalContext.requestedMcpServerIds
        : requestedMcpServerIds,
      requestedMcpToolPrefixes: Array.isArray(approvalContext.requestedMcpToolPrefixes)
        ? approvalContext.requestedMcpToolPrefixes
        : requestedMcpToolPrefixes,
      requestedRagCollectionId: approvalContext.requestedRagCollectionId || requestedRagCollectionId,
      requestedRagCollectionIds: Array.isArray(approvalContext.requestedRagCollectionIds)
        ? approvalContext.requestedRagCollectionIds
        : requestedRagCollectionIds,
      requestedEmbeddingAiId: approvalContext.requestedEmbeddingAiId || requestedEmbeddingAiId,
      requestedAttachments,
      approvedToolApprovalId: pendingToolApproval.approvalId
    })

    sendJson(response, 200, {
      session: await attachWorkspaceState(approvedSession || preparedSession)
    })
    return
  }

  if (!session) {
    session = await sessionRepository.createSession()
    sessionId = session.sessionId
    setRequestAuditSession(request, sessionId)
    createdNewSession = true
    auditSystemAction(sessionId, 'session_created', {
      requestId: request.auditContext?.requestId,
      source: 'chat'
    })
  }

  await sessionWorkspaces.ensureSessionWorkspace(sessionId)
  await sessionRepository.updateSession(sessionId, (draftSession) => {
    draftSession.workspaceFolder = sessionWorkspaces.getWorkspaceFolderLabel(sessionId)
    return draftSession
  })

  const preparedSession = await sessionRepository.prepareSessionForTask({
    sessionId,
    message,
    aiId: aiConfig.aiId,
    model: selectedModel,
    skillId: primarySkill?.skillId || '',
    skillIds: activeSkills.map((item) => item.skillId)
  })

  if (!preparedSession) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  auditLogger.logUserMessage({
    sessionId,
    content: message,
    aiId: aiConfig.aiId,
    model: selectedModel,
    skillIds: activeSkills.map((item) => item.skillId),
    mcpServerIds: requestedMcpServerIds,
    ragCollectionIds: requestedRagCollectionIds,
    embeddingAiId: requestedEmbeddingAiId,
    attachmentCount: requestedAttachments.length,
    createdNewSession
  })

  if (looksLikeLarkChatInfoRequest(message)) {
    try {
      const chatList = await listLarkChatsViaMcp({ sessionId })
      await sessionRepository.appendAssistantMessage(sessionId, {
        content: createLarkChatListAssistantContent(chatList),
        model: selectedModel
      })
      const completedSession = await sessionRepository.updateSession(sessionId, (draftSession) => {
        const timestamp = new Date().toISOString()
        draftSession.task = {
          ...draftSession.task,
          status: 'completed',
          summary: chatList.items.length
            ? `已获取 ${chatList.items.length} 个机器人可见的飞书群聊。`
            : '未找到机器人可见的飞书群聊。',
          steps: [
            {
              stepId: createId('step'),
              title: '获取飞书群聊',
              status: 'completed',
              summary: chatList.items.length
                ? `已通过 ${chatList.tool || 'Lark MCP'} 获取群聊列表。`
                : 'Lark MCP 返回了空群聊列表。',
              startedAt: timestamp,
              completedAt: timestamp,
              updatedAt: timestamp
            }
          ],
          completedAt: timestamp,
          updatedAt: timestamp
        }
        return draftSession
      })

      sendJson(response, 200, {
        session: await attachWorkspaceState(completedSession)
      })
    } catch (error) {
      await sessionRepository.appendAssistantMessage(sessionId, {
        content: `处理失败：${error instanceof Error ? error.message : '读取飞书群聊列表失败。'}`,
        model: selectedModel
      })
      const failedSession = await sessionRepository.updateSession(sessionId, (draftSession) => {
        const timestamp = new Date().toISOString()
        draftSession.task = {
          ...draftSession.task,
          status: 'failed',
          summary: error instanceof Error ? error.message : '读取飞书群聊列表失败。',
          completedAt: timestamp,
          updatedAt: timestamp
        }
        return draftSession
      })

      sendJson(response, 200, {
        session: await attachWorkspaceState(failedSession)
      })
    }
    return
  }

  void agentRunner.startTask({
    sessionId,
    requestedAiId: aiConfig.aiId,
    requestedModel: selectedModel,
    requestedSkillId: primarySkill?.skillId || '',
    requestedSkillIds: activeSkills.map((item) => item.skillId),
    requestedManualSkillIds: requestedSkillIds,
    requestedMcpServerIds,
    requestedMcpToolPrefixes,
    requestedRagCollectionId,
    requestedRagCollectionIds,
    requestedEmbeddingAiId,
    requestedAttachments
  })

  sendJson(response, 200, {
    session: await attachWorkspaceState(preparedSession)
  })
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  const { pathname } = requestUrl
  attachApiAudit(request, response, requestUrl)

  if (request.method === 'OPTIONS') {
    sendEmpty(response, 204)
    return
  }

  if (pathname === '/api/health' && request.method === 'GET') {
    const memoryStatus = await memoryStore.getStatus()

    sendJson(response, 200, {
      status: 'ok',
      now: new Date().toISOString(),
      sessionStore: config.storage.sessionsDir,
      legacySessionStore: config.storage.legacySessionsFile,
      auditStore: config.storage.auditDir,
      memoryStore: memoryStatus.databasePath || config.storage.memoryDir,
      workspaceRoot: config.workspace.rootDir,
      allowedCommands: config.workspace.allowedCommands,
      enableWriteTools: config.workspace.enableWriteTools,
      autoVerifyAfterWrite: config.workspace.autoVerifyAfterWrite,
      autoVerifyCommands: config.workspace.autoVerifyCommands,
      skills: skillRegistry.listSkills(),
      mcpServers: mcpRegistry.getServerSummaries(),
      contextMemory: {
        enabled: Boolean(config.ai.contextMemoryEnabled),
        countUnit: 'turn',
        thresholdTurns: config.ai.contextMemoryThreshold,
        keepTurns: config.ai.contextMemoryKeepMessages,
        minBatchTurns: config.ai.contextMemoryMinBatchMessages,
        thresholdMessages: config.ai.contextMemoryThreshold,
        keepMessages: config.ai.contextMemoryKeepMessages,
        minBatchMessages: config.ai.contextMemoryMinBatchMessages,
        maxSummaryChars: config.ai.contextMemoryMaxChars,
        userProfileEnabled: Boolean(config.ai.userProfileMemoryEnabled),
        userProfile: memoryStatus
      },
      rag: await ragStore.getStatus(),
      toolCount: toolRunner.getToolCatalog().length,
      aiConfigs: (await loadAiConfigs(config.ai)).map((item) => ({
        aiId: item.aiId,
        name: item.name,
        type: item.type || 'ai',
        hasApiKey: Boolean(item.apiKey),
        source: item.source || ''
      }))
    })
    return
  }

  if (pathname === '/api/agent/login' && request.method === 'POST') {
    await handleLogin(request, response)
    return
  }

  if (pathname === '/api/auth/refresh' && request.method === 'POST') {
    await handleRefreshAuthToken(request, response)
    return
  }

  const workspacePreviewRequest = matchWorkspacePreviewPath(pathname)

  if (workspacePreviewRequest && request.method === 'GET') {
    await handleGetWorkspacePreviewFile(request, response, workspacePreviewRequest)
    return
  }

  if (pathname.startsWith('/api/')) {
    const authPayload = requireAuth(request, response)

    if (!authPayload) {
      return
    }
  }

  if (pathname === '/api/ai/configs' && request.method === 'GET') {
    await handleListAiConfigs(requestUrl, response)
    return
  }

  if (pathname === '/api/ai/configs' && request.method === 'POST') {
    await handleCreateAiConfig(request, response)
    return
  }

  const aiConfigId = matchAiConfigPath(pathname)

  if (aiConfigId && request.method === 'PUT') {
    await handleUpdateAiConfig(request, response, aiConfigId)
    return
  }

  if (pathname === '/api/agent/sessions' && request.method === 'GET') {
    await handleListSessions(response)
    return
  }

  if (pathname === '/api/agent/analytics/token-usage' && request.method === 'GET') {
    await handleGetTokenUsageAnalytics(response)
    return
  }

  if (pathname === '/api/agent/audit/sessions' && request.method === 'GET') {
    await handleListAuditSessions(response)
    return
  }

  if (pathname === '/api/agent/audit/events' && request.method === 'GET') {
    await handleListAuditEvents(response, requestUrl)
    return
  }

  if (pathname === '/api/agent/memory/profile' && request.method === 'GET') {
    await handleGetUserMemoryProfile(response)
    return
  }

  if (pathname === '/api/agent/skills' && request.method === 'GET') {
    await handleListSkills(response)
    return
  }

  if (pathname === '/api/agent/skill-files' && request.method === 'GET') {
    await handleListSkillFiles(response)
    return
  }

  if (pathname === '/api/agent/skill-file-detail' && request.method === 'GET') {
    await handleGetSkillFileDetail(response, requestUrl)
    return
  }

  if (pathname === '/api/agent/capabilities' && request.method === 'GET') {
    await handleGetCapabilities(response)
    return
  }

  if (pathname === '/api/agent/rag/status' && request.method === 'GET') {
    await handleGetRagStatus(response)
    return
  }

  if (pathname === '/api/agent/rag/init' && request.method === 'POST') {
    await handleInitializeRag(request, response)
    return
  }

  if (pathname === '/api/agent/rag/collections' && request.method === 'GET') {
    await handleListRagCollections(response)
    return
  }

  if (pathname === '/api/agent/rag/collections' && request.method === 'POST') {
    await handleCreateRagCollection(request, response)
    return
  }

  if (pathname === '/api/agent/rag/documents' && request.method === 'GET') {
    await handleListRagDocuments(response, requestUrl)
    return
  }

  if (pathname === '/api/agent/rag/documents' && request.method === 'POST') {
    await handleCreateRagDocument(request, response)
    return
  }

  if (pathname === '/api/agent/rag/upload' && request.method === 'POST') {
    await handleUploadRagDocument(request, response)
    return
  }

  if (pathname === '/api/agent/rag/search' && request.method === 'GET') {
    await handleSearchRag(request, response, requestUrl)
    return
  }

  if (pathname === '/api/agent/rag/rebuild-embeddings' && request.method === 'POST') {
    await handleRebuildRagEmbeddings(request, response)
    return
  }

  if (pathname === '/api/integrations/lark/chats' && request.method === 'GET') {
    await handleListLarkChats(response, requestUrl)
    return
  }

  if (pathname === '/api/agent/tools' && request.method === 'GET') {
    await handleListAgentTools(response)
    return
  }

  if (pathname === '/api/agent/tool-detail' && request.method === 'GET') {
    await handleGetAgentToolDetail(response, requestUrl)
    return
  }

  if (pathname === '/api/agent/sessions' && request.method === 'POST') {
    await handleCreateSession(request, response)
    return
  }

  if (pathname === '/api/agent/chat' && request.method === 'POST') {
    await handleChat(request, response)
    return
  }

  const cancelSessionId = matchSessionCancelPath(pathname)

  if (cancelSessionId && request.method === 'POST') {
    await handleCancelTask(request, response, cancelSessionId)
    return
  }

  const fileContentSessionId = matchSessionFileContentPath(pathname)

  if (fileContentSessionId && request.method === 'GET') {
    await handleGetSessionFileContent(request, response, requestUrl, fileContentSessionId)
    return
  }

  const previewTokenSessionId = matchSessionPreviewTokenPath(pathname)

  if (previewTokenSessionId && request.method === 'GET') {
    await handleCreateWorkspacePreviewToken(request, response, previewTokenSessionId)
    return
  }

  const streamSessionId = matchSessionStreamPath(pathname)

  if (streamSessionId && request.method === 'GET') {
    await handleSessionStream(request, response, streamSessionId)
    return
  }

  const detailSessionId = matchSessionDetailPath(pathname)

  if (detailSessionId && request.method === 'GET') {
    await handleGetSession(response, detailSessionId)
    return
  }

  if (detailSessionId && request.method === 'DELETE') {
    await handleDeleteSession(request, response, detailSessionId)
    return
  }

  const ragDocumentId = matchRagDocumentPath(pathname)

  if (ragDocumentId && request.method === 'DELETE') {
    await handleDeleteRagDocument(request, response, ragDocumentId)
    return
  }

  sendJson(response, 404, {
    message: 'Route not found.'
  })
}

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response)
  } catch (error) {
    const message = normalizeTrimmedString(error?.message) || 'Internal server error.'
    auditLogger.logEvent({
      event: 'error',
      scope: 'http_request',
      method: request.method,
      url: request.url,
      message
    })
    sendJson(response, 500, { message })
  }
})

async function shutdown(signal) {
  console.log(`[agent-api] received ${signal}, flushing audit logs...`)
  auditSystemAction('', 'server_shutdown_requested', {
    signal
  })

  try {
    await auditLogger.shutdown()
  } catch (error) {
    console.warn('[agent-api] failed to flush audit logs:', error instanceof Error ? error.message : error)
  }

  server.close(() => {
    process.exit(0)
  })

  setTimeout(() => {
    process.exit(0)
  }, 3000).unref()
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

try {
  const migratedMessageCount = await sessionRepository.migrateMessagesToStoreIfNeeded()

  if (migratedMessageCount) {
    console.log(`[agent-api] conversation messages migrated to SQLite: ${migratedMessageCount}`)
  }
  auditSystemAction('', 'conversation_messages_migrated', {
    migratedCount: migratedMessageCount,
    storageType: 'sqlite'
  })
} catch (error) {
  auditLogger.logEvent({
    event: 'error',
    scope: 'conversation_messages_migration',
    message: error instanceof Error ? error.message : String(error || '')
  })
  console.warn('[agent-api] failed to migrate conversation messages:', error instanceof Error ? error.message : error)
}

try {
  const importedTokenUsageCount = await tokenUsageStore.backfillFromSessions(await sessionRepository.readAll())

  if (importedTokenUsageCount) {
    console.log(`[agent-api] token usage backfilled: ${importedTokenUsageCount}`)
  }
  auditSystemAction('', 'token_usage_backfilled', {
    importedCount: importedTokenUsageCount
  })
} catch (error) {
  auditLogger.logEvent({
    event: 'error',
    scope: 'token_usage_backfill',
    message: error instanceof Error ? error.message : String(error || '')
  })
  console.warn('[agent-api] failed to backfill token usage:', error instanceof Error ? error.message : error)
}

await sessionRepository.recoverInterruptedTasks()

server.listen(config.port, config.host, () => {
  auditSystemAction('', 'server_started', {
    host: config.host,
    port: config.port,
    sessionStore: config.storage.sessionsDir,
    auditStore: config.storage.auditDir,
    memoryStore: config.storage.memoryDir
  })
  console.log(`[agent-api] listening on http://${config.host}:${config.port}`)
  console.log(`[agent-api] session store: ${config.storage.sessionsDir}`)
  console.log(`[agent-api] skills: ${skillRegistry.listSkills().map((item) => item.skillId).join(', ') || '(none)'}`)

  if (config.auth.secret === 'local-agent-secret') {
    console.warn('[agent-api] AGENT_AUTH_SECRET is using the default value. Change it before production use.')
  }

  void loadAiConfigs(config.ai)
    .then((availableConfigs) => {
      if (!availableConfigs.length) {
        console.warn('[agent-api] No AI configurations are available. Check MySQL AI config env vars or fallback file/env config.')
        return
      }

      console.log(
        `[agent-api] AI configs: ${availableConfigs.map((item) => `${item.aiId}${item.apiKey ? '' : ' (missing key)'}${item.source ? ` [${item.source}]` : ''}`).join(', ')}`
      )

      const readyMcpServers = mcpRegistry.getServerSummaries()
        .filter((item) => item.status === 'ready')
        .map((item) => `${item.serverId} (${item.toolCount})`)

      if (readyMcpServers.length) {
        console.log(`[agent-api] MCP servers: ${readyMcpServers.join(', ')}`)
      }
    })
    .catch((error) => {
      console.warn('[agent-api] failed to load AI configs on startup:', error instanceof Error ? error.message : error)
    })
})
