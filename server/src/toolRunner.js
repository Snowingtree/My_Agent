import { createWorkspace } from './workspace.js'
import { createApplyPatchTool } from './tools/applyPatch.js'
import { createListFilesTool } from './tools/listFiles.js'
import { createReadFileTool } from './tools/readFile.js'
import { createRunCommandTool } from './tools/runCommand.js'
import { createSearchTextTool } from './tools/searchText.js'
import { createWriteFileTool } from './tools/writeFile.js'

const MCP_DISABLED_PREFIX = '__mcp_disabled__'

function serializeJson(value) {
  return JSON.stringify(value, null, 2)
}

export function createToolRunner({
  baseWorkspace = null,
  resolveWorkspace = null,
  workspaceConfig,
  runtimeConfig,
  externalToolProviders = []
} = {}) {
  const workspace = baseWorkspace || createWorkspace(workspaceConfig)

  function getWorkspaceForSession(sessionId = '') {
    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId) {
      return workspace
    }

    if (typeof resolveWorkspace === 'function') {
      return resolveWorkspace(normalizedSessionId) || workspace
    }

    return workspace
  }

  function createLocalTools(activeWorkspace) {
    const toolContext = {
      workspace: activeWorkspace,
      workspaceConfig,
      runtimeConfig
    }

    return [
      createListFilesTool(toolContext),
      createReadFileTool(toolContext),
      createSearchTextTool(toolContext),
      createRunCommandTool(toolContext),
      ...(workspaceConfig.enableWriteTools
        ? [
            createWriteFileTool(toolContext),
            createApplyPatchTool(toolContext)
          ]
        : [])
    ]
  }

  function matchToolPattern(toolName, pattern) {
    const normalizedName = String(toolName || '').trim()
    const normalizedPattern = String(pattern || '').trim()

    if (!normalizedName || !normalizedPattern) {
      return false
    }

    if (normalizedPattern.endsWith('*')) {
      return normalizedName.startsWith(normalizedPattern.slice(0, -1))
    }

    return normalizedName === normalizedPattern || normalizedName.startsWith(`${normalizedPattern}.`)
  }

  function getAllTools(activeWorkspace = workspace) {
    const externalTools = externalToolProviders.flatMap((provider) => {
      try {
        const tools = provider()
        return Array.isArray(tools) ? tools : []
      } catch (error) {
        console.warn('[tool-runner] failed to read external tools:', error instanceof Error ? error.message : error)
        return []
      }
    })

    return [...createLocalTools(activeWorkspace), ...externalTools]
  }

  function normalizeStringArray(value) {
    return Array.isArray(value)
      ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
      : []
  }

  function filterToolsByMcpPrefixes(tools, mcpToolPrefixes = []) {
    const normalizedPrefixes = normalizeStringArray(mcpToolPrefixes)

    if (normalizedPrefixes.includes(MCP_DISABLED_PREFIX)) {
      return tools.filter((tool) => String(tool.source || '').trim() !== 'mcp')
    }

    if (!normalizedPrefixes.length) {
      return tools
    }

    return tools.filter((tool) => {
      if (String(tool.source || '').trim() !== 'mcp') {
        return true
      }

      return normalizedPrefixes.some((prefix) => tool.name.startsWith(`${prefix}.`))
    })
  }

  function filterToolsBySkill(tools, skill) {
    if (!skill) {
      return tools
    }

    let filteredTools = tools

    if (Array.isArray(skill.allowedTools) && skill.allowedTools.length) {
      filteredTools = filteredTools.filter((tool) => (
        skill.allowedTools.some((pattern) => matchToolPattern(tool.name, pattern))
      ))
    }

    if (Array.isArray(skill.disabledTools) && skill.disabledTools.length) {
      filteredTools = filteredTools.filter((tool) => (
        !skill.disabledTools.some((pattern) => matchToolPattern(tool.name, pattern))
      ))
    }

    if (!Array.isArray(skill.preferredTools) || !skill.preferredTools.length) {
      return filteredTools
    }

    return [...filteredTools].sort((left, right) => {
      const leftIndex = skill.preferredTools.findIndex((pattern) => matchToolPattern(left.name, pattern))
      const rightIndex = skill.preferredTools.findIndex((pattern) => matchToolPattern(right.name, pattern))
      const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
      const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex

      if (normalizedLeftIndex !== normalizedRightIndex) {
        return normalizedLeftIndex - normalizedRightIndex
      }

      return left.name.localeCompare(right.name)
    })
  }

  function getFilteredTools(activeWorkspace = workspace, { skill = null, mcpToolPrefixes = [] } = {}) {
    return filterToolsBySkill(
      filterToolsByMcpPrefixes(getAllTools(activeWorkspace), mcpToolPrefixes),
      skill
    )
  }

  function getToolCatalog({ skill = null, mcpToolPrefixes = [] } = {}) {
    return getFilteredTools(workspace, { skill, mcpToolPrefixes }).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      source: String(tool.source || 'local')
    }))
  }

  function getPromptText({ skill = null, mcpToolPrefixes = [] } = {}) {
    return getToolCatalog({ skill, mcpToolPrefixes })
      .map((tool) => [
        `- ${tool.name}: ${tool.description}`,
        `  Source: ${tool.source}`,
        `  Input schema: ${serializeJson(tool.inputSchema)}`
      ].join('\n'))
      .join('\n')
  }

  async function executeToolCall({ name, args } = {}, { skill = null, mcpToolPrefixes = [], signal = null, sessionId = '', onProgress = null } = {}) {
    const normalizedName = String(name || '').trim()
    const activeWorkspace = getWorkspaceForSession(sessionId)
    const allToolsByName = new Map(getAllTools(activeWorkspace).map((tool) => [tool.name, tool]))
    const toolCatalog = getFilteredTools(activeWorkspace, { skill, mcpToolPrefixes })
    const toolsByName = new Map(toolCatalog.map((tool) => [tool.name, tool]))
    const tool = toolsByName.get(normalizedName)

    if (!tool) {
      if (allToolsByName.has(normalizedName) && skill) {
        throw new Error(
          `Tool "${normalizedName}" is not available under the active skill "${skill.skillId}".`
        )
      }

      throw new Error(`Unknown tool: ${normalizedName || '(empty)'}.`)
    }

    const normalizedArgs =
      args && typeof args === 'object' && !Array.isArray(args)
        ? args
        : {}
    const result = await tool.run(normalizedArgs, { signal, onProgress })

    return {
      tool: tool.name,
      args: normalizedArgs,
      result,
      summary: typeof tool.summarize === 'function'
        ? tool.summarize(result, normalizedArgs)
        : `${tool.name} completed.`,
      message: typeof tool.formatMessage === 'function'
        ? tool.formatMessage(result, normalizedArgs)
        : `${tool.name}\n${serializeJson(result)}`
    }
  }

  return {
    workspace,
    resolveWorkspace: getWorkspaceForSession,
    getToolCatalog,
    getPromptText,
    executeToolCall
  }
}
