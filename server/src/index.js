import { createServer } from 'node:http'
import { extname } from 'node:path'
import mammoth from 'mammoth'
import { createConfig } from './config.js'
import { createEmbeddingClient } from './embeddingClient.js'
import { loadEnvFiles } from './env.js'
import { createAuthToken, readBearerToken, safeCompare, verifyAuthToken } from './auth.js'
import { getAiConfigById, insertAiConfig, loadAiConfigs, resolveModel, toPublicAiConfig, updateAiConfig } from './aiConfigs.js'
import { createAgentRunner } from './agentRunner.js'
import { createMcpRegistry } from './mcpRegistry.js'
import { createRagStore } from './ragStore.js'
import { createSessionWorkspacesRepository } from './sessionWorkspaces.js'
import { createSkillLibrary } from './skillLibrary.js'
import { SessionRepository } from './sessionStore.js'
import { createSkillRegistry } from './skillRegistry.js'
import { createTokenUsageStore } from './tokenUsageStore.js'
import { getToolDetailItem, listToolPreviewItems } from './toolCatalogDetails.js'
import { createToolRunner } from './toolRunner.js'
import { createId, normalizeTrimmedString } from './utils.js'
import { createWorkspace } from './workspace.js'

loadEnvFiles()

const config = createConfig()
let sessionWorkspaces = null
const sessionStreamSubscribers = new Map()
const tokenUsageStore = createTokenUsageStore(config.storage.tokenUsageFile)

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
} catch (error) {
  console.warn('[agent-api] failed to initialize MCP registry:', error instanceof Error ? error.message : error)
}
if (config.rag.enabled) {
  try {
    await ragStore.initialize()
  } catch (error) {
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
    () => mcpRegistry.getToolDefinitions()
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
  ragStore
})

function setBaseHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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
  return verifyAuthToken(token, config.auth.secret)
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

function validateLoginPayload(payload) {
  const username = normalizeTrimmedString(payload?.username)
  const password = String(payload?.password ?? '')

  if (!username || !password) {
    return {
      ok: false,
      message: 'Username and password are required.'
    }
  }

  if (
    !safeCompare(username, config.auth.username)
    || !safeCompare(password, config.auth.password)
  ) {
    return {
      ok: false,
      message: 'Invalid username or password.'
    }
  }

  return {
    ok: true,
    username
  }
}

function validateLocalLoginCredentials(payload) {
  const username = normalizeTrimmedString(payload?.username)
  const password = String(payload?.password ?? '')

  return (
    safeCompare(username, config.auth.username)
    && safeCompare(password, config.auth.password)
  )
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

  return CODING_SKILL_HINT_PATTERNS.some((pattern) => pattern.test(normalizedMessage))
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
    return explicitSkills
  }

  if (looksLikeCodingSkillRequest(message)) {
    return [
      skillRegistry.getSkillById('coding_agent')
      || skillRegistry.resolveSkill('')
    ].filter(Boolean)
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

  const token = normalizeTrimmedString(body?.token)

  if (!token) {
    return {
      ok: false,
      statusCode: 502,
      message: 'Shared login succeeded but did not return a token.'
    }
  }

  return {
    ok: true,
    body: {
      token,
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
    sendJson(response, 401, {
      message: validation.message
    })
    return
  }

  if (!validateLocalLoginCredentials(payload)) {
    const sharedLogin = await trySharedAuthLogin(payload)

    if (sharedLogin?.ok) {
      sendJson(response, 200, sharedLogin.body)
      return
    }

    sendJson(response, sharedLogin?.statusCode === 401 ? 401 : 502, {
      message: sharedLogin?.message || 'Invalid username or password.'
    })
    return
  }

  const token = createAuthToken({
    username: validation.username,
    secret: config.auth.secret,
    ttlMs: config.auth.tokenTtlMs
  })

  sendJson(response, 200, {
    token,
    user: {
      username: validation.username
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

    sendJson(response, 201, { item: result })
  } catch (error) {
    sendJson(response, 400, {
      message: error instanceof Error ? error.message : '添加 AI 配置失败。'
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
    sendJson(response, 200, { item: result })
  } catch (error) {
    sendJson(response, 400, {
      message: error instanceof Error ? error.message : 'Update AI config failed.'
    })
  }
}

async function attachWorkspaceState(item) {
  if (!item?.sessionId) {
    return item
  }

  const trackedWorkspaceFiles = Array.isArray(item.workspaceFiles) ? item.workspaceFiles : []

  return {
    ...item,
    workspaceFolder: sessionWorkspaces.getWorkspaceFolderLabel(item.sessionId),
    workspaceFiles: await sessionWorkspaces.listWorkspaceFiles(item.sessionId, trackedWorkspaceFiles)
  }
}

async function handleListSessions(response) {
  const items = await sessionRepository.listSummaries()
  sendJson(response, 200, { items })
}

async function handleGetTokenUsageAnalytics(response) {
  const aiConfigs = await loadAiConfigs(config.ai)
  sendJson(response, 200, await tokenUsageStore.getAnalytics(aiConfigs))
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

  sendJson(response, 201, { item })
}

async function handleInitializeRag(response) {
  try {
    sendJson(response, 200, await ragStore.initialize())
  } catch (error) {
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

  sendJson(response, 201, { items })
}

async function handleSearchRag(response, requestUrl) {
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

  sendJson(response, 200, {
    items: await ragStore.search({ query, collectionId, limit, embeddingAiId })
  })
}

async function handleRebuildRagEmbeddings(request, response) {
  const payload = await readJsonBody(request)
  const result = await ragStore.rebuildEmbeddings({
    collectionId: normalizeTrimmedString(payload?.collectionId),
    limit: Number.parseInt(payload?.limit || '', 10),
    embeddingAiId: normalizeTrimmedString(payload?.embeddingAiId)
  })

  sendJson(response, 200, result)
}

async function handleDeleteRagDocument(response, documentId) {
  sendJson(response, 200, await ragStore.deleteDocument(documentId))
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
  const larkChatListTools = toolRunner.getToolCatalog()
    .filter((tool) => {
      const name = String(tool?.name || '').toLowerCase()
      return name.startsWith('mcp.lark.')
        && name.includes('chat')
        && (name.includes('list') || name.includes('get') || name.includes('search'))
    })
    .map((tool) => tool.name)

  if (!larkChatListTools.length) {
    const error = new Error('当前 Lark MCP 没有加载群聊列表工具。请确认 IM 群组权限和 AGENT_LARK_TOOLS 配置。')
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

  for (const toolName of larkChatListTools) {
    for (const args of argCandidates) {
      try {
        const toolExecution = await toolRunner.executeToolCall(
          { name: toolName, args },
          { sessionId }
        )
        const items = normalizeLarkChatListResult(toolExecution)

        return {
          items,
          tool: toolName
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error || '')
      }
    }
  }

  throw new Error(lastError || '读取飞书群聊列表失败。')
}

async function handleListLarkChats(response, requestUrl) {
  const sessionId = normalizeTrimmedString(requestUrl?.searchParams?.get('sessionId'))

  try {
    sendJson(response, 200, await listLarkChatsViaMcp({ sessionId }))
  } catch (error) {
    sendJson(response, error?.statusCode || 500, {
      message: error instanceof Error ? error.message : '读取飞书群聊列表失败。'
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

  if (!normalizedServerIds.length) {
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

async function handleCreateSession(response) {
  const item = await sessionRepository.createSession()
  await sessionWorkspaces.ensureSessionWorkspace(item.sessionId)
  const updatedItem = await sessionRepository.updateSession(item.sessionId, (session) => {
    session.workspaceFolder = sessionWorkspaces.getWorkspaceFolderLabel(item.sessionId)
    return session
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

async function handleGetSessionFileContent(response, requestUrl, sessionId) {
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

  sendJson(response, 200, { item })
}

async function handleDeleteSession(response, sessionId) {
  const removed = await sessionRepository.deleteSession(sessionId)

  if (!removed) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  await sessionWorkspaces.deleteSessionWorkspace(sessionId)
  sendEmpty(response, 204)
}

async function handleCancelTask(response, sessionId) {
  const item = await agentRunner.cancelTask(sessionId)

  if (!item) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

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

  if (!session) {
    session = await sessionRepository.createSession()
    sessionId = session.sessionId
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
            ? `已获取 ${chatList.items.length} 个飞书群聊。`
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

  if (request.method === 'OPTIONS') {
    sendEmpty(response, 204)
    return
  }

  if (pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, {
      status: 'ok',
      now: new Date().toISOString(),
      sessionStore: config.storage.sessionsDir,
      legacySessionStore: config.storage.legacySessionsFile,
      workspaceRoot: config.workspace.rootDir,
      allowedCommands: config.workspace.allowedCommands,
      enableWriteTools: config.workspace.enableWriteTools,
      autoVerifyAfterWrite: config.workspace.autoVerifyAfterWrite,
      autoVerifyCommands: config.workspace.autoVerifyCommands,
      skills: skillRegistry.listSkills(),
      mcpServers: mcpRegistry.getServerSummaries(),
      contextMemory: {
        enabled: Boolean(config.ai.contextMemoryEnabled),
        thresholdMessages: config.ai.contextMemoryThreshold,
        keepMessages: config.ai.contextMemoryKeepMessages,
        minBatchMessages: config.ai.contextMemoryMinBatchMessages,
        maxSummaryChars: config.ai.contextMemoryMaxChars
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

  if (pathname === '/api/login' && request.method === 'POST') {
    await handleLogin(request, response)
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
    await handleInitializeRag(response)
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
    await handleSearchRag(response, requestUrl)
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
    await handleCreateSession(response)
    return
  }

  if (pathname === '/api/agent/chat' && request.method === 'POST') {
    await handleChat(request, response)
    return
  }

  const cancelSessionId = matchSessionCancelPath(pathname)

  if (cancelSessionId && request.method === 'POST') {
    await handleCancelTask(response, cancelSessionId)
    return
  }

  const fileContentSessionId = matchSessionFileContentPath(pathname)

  if (fileContentSessionId && request.method === 'GET') {
    await handleGetSessionFileContent(response, requestUrl, fileContentSessionId)
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
    await handleDeleteSession(response, detailSessionId)
    return
  }

  const ragDocumentId = matchRagDocumentPath(pathname)

  if (ragDocumentId && request.method === 'DELETE') {
    await handleDeleteRagDocument(response, ragDocumentId)
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
    sendJson(response, 500, { message })
  }
})

try {
  const importedTokenUsageCount = await tokenUsageStore.backfillFromSessions(await sessionRepository.readAll())

  if (importedTokenUsageCount) {
    console.log(`[agent-api] token usage backfilled: ${importedTokenUsageCount}`)
  }
} catch (error) {
  console.warn('[agent-api] failed to backfill token usage:', error instanceof Error ? error.message : error)
}

await sessionRepository.recoverInterruptedTasks()

server.listen(config.port, config.host, () => {
  console.log(`[agent-api] listening on http://${config.host}:${config.port}`)
  console.log(`[agent-api] session store: ${config.storage.sessionsDir}`)
  console.log(`[agent-api] skills: ${skillRegistry.listSkills().map((item) => item.skillId).join(', ') || '(none)'}`)

  if (config.auth.password === 'change-me-please') {
    console.warn('[agent-api] AGENT_ADMIN_PASSWORD is using the default value. Change it before production use.')
  }

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
