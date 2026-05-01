import { createServer } from 'node:http'
import { createConfig } from './config.js'
import { loadEnvFiles } from './env.js'
import { createAuthToken, readBearerToken, safeCompare, verifyAuthToken } from './auth.js'
import { getAiConfigById, loadAiConfigs, resolveModel, toPublicAiConfig } from './aiConfigs.js'
import { createAgentRunner } from './agentRunner.js'
import { createMcpRegistry } from './mcpRegistry.js'
import { createSessionWorkspacesRepository } from './sessionWorkspaces.js'
import { SessionRepository } from './sessionStore.js'
import { createSkillRegistry } from './skillRegistry.js'
import { getToolDetailItem, listToolPreviewItems } from './toolCatalogDetails.js'
import { createToolRunner } from './toolRunner.js'
import { createId, normalizeTrimmedString } from './utils.js'
import { createWorkspace } from './workspace.js'

loadEnvFiles()

const config = createConfig()
let sessionWorkspaces = null
const sessionStreamSubscribers = new Map()

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
  }
})
const skillRegistry = createSkillRegistry(config.skills)
const sourceWorkspace = createWorkspace(config.workspace)
const mcpRegistry = createMcpRegistry({
  mcpConfig: config.mcp
})
try {
  await mcpRegistry.initialize()
} catch (error) {
  console.warn('[agent-api] failed to initialize MCP registry:', error instanceof Error ? error.message : error)
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
  toolRunner
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

    if (size > 1024 * 1024) {
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
  /写代码|改代码|生成代码|创建页面|新建页面|创建组件|修改文件|读取文件|搜索文件|报错|调试|修复|构建|运行命令|接口|前端|后端|项目|工作区|代码库|样式|脚本|组件/
]

function looksLikeCodingSkillRequest(message) {
  const normalizedMessage = normalizeTrimmedString(message)

  if (!normalizedMessage) {
    return false
  }

  return CODING_SKILL_HINT_PATTERNS.some((pattern) => pattern.test(normalizedMessage))
}

function resolveSkillForMessage(requestedSkillId, message) {
  const explicitSkill = skillRegistry.getSkillById(requestedSkillId)

  if (explicitSkill) {
    return explicitSkill
  }

  if (looksLikeCodingSkillRequest(message)) {
    return (
      skillRegistry.getSkillById('coding_agent')
      || skillRegistry.resolveSkill(requestedSkillId)
    )
  }

  return (
    skillRegistry.getSkillById('general_chat')
    || skillRegistry.resolveSkill(requestedSkillId)
  )
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

async function handleListAiConfigs(response) {
  const items = (await loadAiConfigs(config.ai)).map((item) => toPublicAiConfig(item))

  sendJson(response, 200, { items })
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

async function handleListSkills(response) {
  sendJson(response, 200, {
    items: skillRegistry.listSkills()
  })
}

async function handleGetCapabilities(response) {
  sendJson(response, 200, {
    skills: skillRegistry.listSkills(),
    tools: toolRunner.getToolCatalog(),
    mcpServers: mcpRegistry.getServerSummaries()
  })
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
  const requestedSkillId = normalizeTrimmedString(payload?.skillId)
  const activeSkill = resolveSkillForMessage(requestedSkillId, message)

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
    skillId: activeSkill?.skillId || ''
  })

  if (!preparedSession) {
    sendJson(response, 404, {
      message: 'Session not found.'
    })
    return
  }

  void agentRunner.startTask({
    sessionId,
    requestedAiId: aiConfig.aiId,
    requestedModel: selectedModel,
    requestedSkillId: activeSkill?.skillId || ''
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
      toolCount: toolRunner.getToolCatalog().length,
      aiConfigs: (await loadAiConfigs(config.ai)).map((item) => ({
        aiId: item.aiId,
        name: item.name,
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
    await handleListAiConfigs(response)
    return
  }

  if (pathname === '/api/agent/sessions' && request.method === 'GET') {
    await handleListSessions(response)
    return
  }

  if (pathname === '/api/agent/skills' && request.method === 'GET') {
    await handleListSkills(response)
    return
  }

  if (pathname === '/api/agent/capabilities' && request.method === 'GET') {
    await handleGetCapabilities(response)
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
