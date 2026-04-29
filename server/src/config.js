import { isAbsolute, resolve } from 'node:path'
import { SERVER_ROOT } from './env.js'

function readNumberEnv(name, fallbackValue) {
  const rawValue = String(process.env[name] || '').trim()
  const parsedValue = Number.parseInt(rawValue, 10)

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue
}

function readTokenTtlMs() {
  const explicitMilliseconds = readNumberEnv('AGENT_TOKEN_TTL_MS', 0)

  if (explicitMilliseconds > 0) {
    return explicitMilliseconds
  }

  const legacySeconds = readNumberEnv('AUTH_TOKEN_TTL_SECONDS', 0)

  if (legacySeconds > 0) {
    return legacySeconds * 1000
  }

  return 7 * 24 * 60 * 60 * 1000
}

function resolveServerPath(pathValue, fallbackRelativePath) {
  const candidate = String(pathValue || '').trim()

  if (!candidate) {
    return resolve(SERVER_ROOT, fallbackRelativePath)
  }

  return isAbsolute(candidate) ? candidate : resolve(SERVER_ROOT, candidate)
}

function normalizeBooleanEnv(value, fallbackValue = false) {
  const normalized = String(value || '').trim().toLowerCase()

  if (!normalized) {
    return fallbackValue
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

function normalizeCommandSpec(item) {
  const command = String(item?.command || '').trim()
  const args = Array.isArray(item?.args)
    ? item.args.map((arg) => String(arg ?? '')).filter(Boolean)
    : []
  const cwd = String(item?.cwd || '.').trim() || '.'

  if (!command) {
    return null
  }

  return {
    command,
    args,
    cwd
  }
}

function parseInlineCommandSpec(rawValue) {
  const parts = String(rawValue || '').trim().split(/\s+/).filter(Boolean)

  if (!parts.length) {
    return null
  }

  const [command, ...args] = parts

  return {
    command,
    args,
    cwd: '.'
  }
}

function readAutoVerifyCommands() {
  const jsonValue = String(process.env.AGENT_AUTO_VERIFY_COMMANDS_JSON || '').trim()

  if (jsonValue) {
    const parsedValue = JSON.parse(jsonValue)
    const items = Array.isArray(parsedValue)
      ? parsedValue
      : Array.isArray(parsedValue?.items)
        ? parsedValue.items
        : []

    return items.map((item) => normalizeCommandSpec(item)).filter(Boolean)
  }

  const inlineValue = String(process.env.AGENT_AUTO_VERIFY_COMMANDS || '').trim()

  if (!inlineValue) {
    return []
  }

  return inlineValue
    .split(';;')
    .map((item) => parseInlineCommandSpec(item))
    .filter(Boolean)
}

export function createConfig() {
  const agentPort = readNumberEnv('AGENT_PORT', readNumberEnv('API_PORT', 3001))
  const explicitSharedAuthBaseUrl = normalizeBaseUrl(process.env.AGENT_SHARED_AUTH_BASE_URL)
  const inferredSharedAuthBaseUrl = agentPort === 3001 ? '' : 'http://127.0.0.1:3001'
  const workspaceRootDir = resolveServerPath(process.env.AGENT_WORKSPACE_ROOT, '..')
  const defaultAgentStorageDir = resolve(
    workspaceRootDir,
    '..',
    'storage',
    'agent'
  )
  const defaultSessionWorkspacesDir = resolve(defaultAgentStorageDir, 'agent-workspace')
  const sessionWorkspacesDir = process.env.AGENT_SESSION_WORKSPACES_DIR
    ? resolveServerPath(process.env.AGENT_SESSION_WORKSPACES_DIR, 'data/session-workspaces')
    : defaultSessionWorkspacesDir
  const sessionsDir = process.env.AGENT_SESSIONS_DIR
    ? resolveServerPath(process.env.AGENT_SESSIONS_DIR, 'data/sessions')
    : resolve(defaultAgentStorageDir, 'sessions')

  return {
    serverRoot: SERVER_ROOT,
    host: String(process.env.AGENT_HOST || process.env.API_HOST || '127.0.0.1').trim() || '127.0.0.1',
    port: agentPort,
    auth: {
      username: String(process.env.AGENT_ADMIN_USERNAME || 'admin').trim() || 'admin',
      password: String(process.env.AGENT_ADMIN_PASSWORD || 'change-me-please').trim() || 'change-me-please',
      secret: String(process.env.AGENT_AUTH_SECRET || process.env.AUTH_TOKEN_SECRET || 'local-agent-secret').trim() || 'local-agent-secret',
      tokenTtlMs: readTokenTtlMs(),
      sharedAuthBaseUrl: explicitSharedAuthBaseUrl || inferredSharedAuthBaseUrl,
      sharedAuthLoginPath: String(process.env.AGENT_SHARED_AUTH_LOGIN_PATH || '/api/login').trim() || '/api/login',
      sharedAuthTimeoutMs: readNumberEnv('AGENT_SHARED_AUTH_TIMEOUT_MS', 10000)
    },
    storage: {
      dataDir: resolveServerPath(process.env.AGENT_DATA_DIR, 'data'),
      legacySessionsFile: resolveServerPath(process.env.AGENT_SESSIONS_FILE, 'data/sessions.json'),
      sessionsDir,
      sessionArtifactsDir: resolveServerPath(process.env.AGENT_SESSION_ARTIFACTS_DIR, 'data/session-files'),
      sessionWorkspacesDir
    },
    ai: {
      configPath: resolveServerPath(process.env.AGENT_AI_CONFIG_PATH, 'config/ai-configs.json'),
      requestTimeoutMs: readNumberEnv('AGENT_AI_TIMEOUT_MS', 120000),
      timeoutRetries: readNumberEnv('AGENT_AI_TIMEOUT_RETRIES', 2),
      timeoutRetryDelayMs: readNumberEnv('AGENT_AI_TIMEOUT_RETRY_DELAY_MS', 1500),
      recentMessages: readNumberEnv('AGENT_CONTEXT_MESSAGES', 12),
      maxPlanSteps: readNumberEnv('AGENT_MAX_PLAN_STEPS', 5)
    },
    skills: {
      configPath: resolveServerPath(process.env.AGENT_SKILLS_CONFIG_PATH, 'config/skills.json'),
      defaultSkillId: String(process.env.AGENT_DEFAULT_SKILL_ID || '').trim()
    },
    mcp: {
      enabled: normalizeBooleanEnv(process.env.AGENT_MCP_ENABLED, true),
      configPath: resolveServerPath(process.env.AGENT_MCP_CONFIG_PATH, 'config/mcp-servers.json'),
      requestTimeoutMs: readNumberEnv('AGENT_MCP_TIMEOUT_MS', 30000),
      protocolVersion: String(process.env.AGENT_MCP_PROTOCOL_VERSION || '2025-11-25').trim() || '2025-11-25'
    },
    workspace: {
      rootDir: workspaceRootDir,
      maxFileSizeBytes: readNumberEnv('AGENT_MAX_FILE_SIZE_BYTES', 256 * 1024),
      maxWriteSizeBytes: readNumberEnv('AGENT_MAX_WRITE_SIZE_BYTES', 512 * 1024),
      maxSearchResults: readNumberEnv('AGENT_MAX_SEARCH_RESULTS', 50),
      maxCommandOutputChars: readNumberEnv('AGENT_MAX_COMMAND_OUTPUT_CHARS', 12000),
      allowedCommands: String(process.env.AGENT_ALLOWED_COMMANDS || 'npm,node,git,rg')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      autoVerifyAfterWrite: normalizeBooleanEnv(process.env.AGENT_AUTO_VERIFY_AFTER_WRITE, true),
      autoVerifyCommands: readAutoVerifyCommands(),
      enableWriteTools: String(process.env.AGENT_ENABLE_WRITE_TOOLS || '')
        .trim()
        .toLowerCase() === 'true'
    },
    runtime: {
      stepDelayMs: readNumberEnv('AGENT_STEP_DELAY_MS', 350),
      taskTimeoutMs: readNumberEnv('AGENT_TASK_TIMEOUT_MS', 15 * 60 * 1000),
      commandTimeoutMs: readNumberEnv('AGENT_COMMAND_TIMEOUT_MS', 120000),
      maxToolIterations: readNumberEnv('AGENT_MAX_TOOL_ITERATIONS', 6)
    }
  }
}
