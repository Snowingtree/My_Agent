import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { StdioMcpClient } from './mcp/client.js'
import { normalizeTrimmedString } from './utils.js'

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null
  }

  const rawValue = readFileSync(filePath, 'utf8').trim()

  if (!rawValue) {
    return null
  }

  return JSON.parse(rawValue)
}

function normalizeBoolean(value, fallbackValue = true) {
  const normalized = String(value ?? '').trim().toLowerCase()

  if (!normalized) {
    return fallbackValue
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(
    value
      .map((item) => normalizeTrimmedString(item))
      .filter(Boolean)
  )]
}

function truncateText(value, maxChars = 1200) {
  const normalized = String(value || '').trim()
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}\n...truncated...`
    : normalized
}

function serializeJson(value, maxChars = 4000) {
  const serialized = JSON.stringify(value, null, 2)

  return serialized.length > maxChars
    ? `${serialized.slice(0, maxChars)}\n...truncated...`
    : serialized
}

function matchToolPattern(toolName, pattern) {
  const normalizedName = normalizeTrimmedString(toolName)
  const normalizedPattern = normalizeTrimmedString(pattern)

  if (!normalizedName || !normalizedPattern) {
    return false
  }

  if (normalizedPattern.endsWith('*')) {
    return normalizedName.startsWith(normalizedPattern.slice(0, -1))
  }

  return normalizedName === normalizedPattern || normalizedName.startsWith(`${normalizedPattern}.`)
}

function resolveConfigRelativePath(configPath, candidatePath) {
  const normalizedPath = normalizeTrimmedString(candidatePath)

  if (!normalizedPath) {
    return ''
  }

  return isAbsolute(normalizedPath)
    ? normalizedPath
    : resolve(dirname(configPath), normalizedPath)
}

function expandEnvTemplate(value) {
  const normalizedValue = String(value ?? '')

  if (!normalizedValue) {
    return ''
  }

  return normalizedValue.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, envName) => (
    String(process.env?.[envName] ?? '')
  ))
}

function normalizeServerDefinition(item, index, configPath, mcpConfig) {
  const serverId = normalizeTrimmedString(item?.serverId) || `mcp_server_${index + 1}`
  const transport = normalizeTrimmedString(item?.transport).toLowerCase() || 'stdio'
  const command = normalizeTrimmedString(expandEnvTemplate(item?.command))
  const rawArgs = Array.isArray(item?.args)
    ? item.args.map((arg) => expandEnvTemplate(arg)).map((arg) => String(arg ?? '')).filter(Boolean)
    : []
  const rawEnv = item?.env && typeof item.env === 'object' && !Array.isArray(item.env)
    ? Object.fromEntries(
      Object.entries(item.env)
        .map(([key, value]) => [String(key || '').trim(), expandEnvTemplate(value)])
        .filter(([key]) => Boolean(key))
    )
    : {}
  const resolvedCwd = resolveConfigRelativePath(configPath, expandEnvTemplate(item?.cwd)) || dirname(configPath)

  return {
    serverId,
    name: normalizeTrimmedString(item?.name) || serverId,
    enabled: normalizeBoolean(item?.enabled, false),
    transport,
    command,
    args: rawArgs,
    cwd: resolvedCwd,
    env: rawEnv,
    toolNamePrefix: normalizeTrimmedString(item?.toolNamePrefix) || `mcp.${serverId}`,
    includeTools: normalizeStringArray(item?.includeTools),
    excludeTools: normalizeStringArray(item?.excludeTools),
    timeoutMs: Number.isFinite(Number(item?.timeoutMs)) && Number(item.timeoutMs) > 0
      ? Number(item.timeoutMs)
      : mcpConfig.requestTimeoutMs
  }
}

function collectServerDefinitions(rawValue, configPath) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((item) => ({
      item,
      configPath
    }))
  }

  if (!rawValue || typeof rawValue !== 'object') {
    return []
  }

  const inlineItems = Array.isArray(rawValue.items)
    ? rawValue.items.map((item) => ({
      item,
      configPath
    }))
    : []
  const referencedItems = Array.isArray(rawValue.files)
    ? rawValue.files.flatMap((filePath) => {
      const resolvedPath = resolveConfigRelativePath(configPath, filePath)
      const childValue = resolvedPath ? readJsonFile(resolvedPath) : null
      return collectServerDefinitions(childValue, resolvedPath)
    })
    : []

  if (rawValue.serverId || rawValue.command) {
    return [
      {
        item: rawValue,
        configPath
      },
      ...inlineItems,
      ...referencedItems
    ]
  }

  return [
    ...inlineItems,
    ...referencedItems
  ]
}

function normalizeMcpTool(definition, rawTool) {
  const remoteName = normalizeTrimmedString(rawTool?.name)

  if (!remoteName) {
    return null
  }

  const fullName = `${definition.toolNamePrefix}.${remoteName}`

  return {
    remoteName,
    fullName,
    description: normalizeTrimmedString(rawTool?.description) || `MCP tool ${remoteName}`,
    inputSchema:
      rawTool?.inputSchema && typeof rawTool.inputSchema === 'object'
        ? rawTool.inputSchema
        : { type: 'object', properties: {} }
  }
}

function shouldIncludeTool(definition, toolName) {
  if (definition.includeTools.length && !definition.includeTools.some((pattern) => matchToolPattern(toolName, pattern))) {
    return false
  }

  if (definition.excludeTools.some((pattern) => matchToolPattern(toolName, pattern))) {
    return false
  }

  return true
}

function extractMcpText(result) {
  const contentItems = Array.isArray(result?.content) ? result.content : []
  const textChunks = contentItems
    .map((item) => (
      typeof item?.text === 'string'
        ? item.text
        : item?.type === 'text' && typeof item?.content === 'string'
          ? item.content
          : ''
    ))
    .filter(Boolean)

  return textChunks.join('\n\n').trim()
}

function normalizeMcpCallResult({
  server,
  tool,
  result
}) {
  const structuredContent =
    result?.structuredContent && typeof result.structuredContent === 'object'
      ? result.structuredContent
      : null
  const text = extractMcpText(result)

  return {
    serverId: server.serverId,
    serverName: server.name,
    toolName: tool.remoteName,
    fullToolName: tool.fullName,
    isError: Boolean(result?.isError),
    text,
    content: Array.isArray(result?.content) ? result.content : [],
    structuredContent,
    raw: result
  }
}

function createMcpToolDefinition(serverState, tool) {
  return {
    name: tool.fullName,
    source: 'mcp',
    description: `[MCP:${serverState.definition.name}] ${tool.description}`,
    inputSchema: tool.inputSchema,
    async run(args = {}, executionContext = {}) {
      const result = await serverState.client.callTool(tool.remoteName, args, {
        signal: executionContext.signal
      })

      return normalizeMcpCallResult({
        server: serverState.definition,
        tool,
        result
      })
    },
    summarize(result) {
      return result.isError
        ? `MCP tool ${result.toolName} reported an error via ${result.serverName}.`
        : `MCP tool ${result.toolName} completed via ${result.serverName}.`
    },
    formatMessage(result) {
      return [
        `Tool: ${result.fullToolName}`,
        `Server: ${result.serverName}`,
        `Status: ${result.isError ? 'error' : 'ok'}`,
        '',
        result.text
          ? `Text output:\n${truncateText(result.text)}`
          : `Structured output:\n${serializeJson(result.structuredContent || result.raw || {})}`
      ].join('\n')
    }
  }
}

export function createMcpRegistry({
  mcpConfig
} = {}) {
  const serverStates = []

  function loadDefinitions() {
    const rawValue = readJsonFile(mcpConfig.configPath)
    const definitions = collectServerDefinitions(rawValue, mcpConfig.configPath)

    return definitions.map(({ item, configPath }, index) => (
      normalizeServerDefinition(item, index, configPath, mcpConfig)
    ))
  }

  async function initialize() {
    await closeAll()
    serverStates.length = 0

    if (!mcpConfig.enabled) {
      return
    }

    const definitions = loadDefinitions()

    for (const definition of definitions) {
      const state = {
        definition,
        status: definition.enabled ? 'connecting' : 'disabled',
        error: '',
        client: null,
        tools: []
      }

      serverStates.push(state)

      if (!definition.enabled) {
        continue
      }

      if (definition.transport !== 'stdio') {
        state.status = 'error'
        state.error = `Unsupported MCP transport: ${definition.transport}`
        continue
      }

      try {
        const client = new StdioMcpClient({
          command: definition.command,
          args: definition.args,
          cwd: definition.cwd,
          env: {
            ...process.env,
            ...definition.env
          },
          timeoutMs: definition.timeoutMs,
          protocolVersion: mcpConfig.protocolVersion
        })

        await client.start()
        const tools = await client.listTools()

        state.client = client
        state.tools = tools
          .map((item) => normalizeMcpTool(definition, item))
          .filter(Boolean)
          .filter((item) => shouldIncludeTool(definition, item.remoteName))
        state.status = 'ready'
      } catch (error) {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : 'Unknown MCP startup error.'
      }
    }
  }

  async function closeAll() {
    await Promise.all(serverStates.map(async (state) => {
      if (state.client) {
        await state.client.close()
      }
    }))
  }

  function getServerSummaries() {
    return serverStates.map((state) => ({
      serverId: state.definition.serverId,
      name: state.definition.name,
      enabled: state.definition.enabled,
      transport: state.definition.transport,
      status: state.status,
      error: state.error,
      toolNamePrefix: state.definition.toolNamePrefix,
      toolCount: state.tools.length
    }))
  }

  function getToolDefinitions() {
    return serverStates
      .filter((state) => state.status === 'ready' && state.client)
      .flatMap((state) => state.tools.map((tool) => createMcpToolDefinition(state, tool)))
  }

  return {
    initialize,
    closeAll,
    getServerSummaries,
    getToolDefinitions
  }
}
