import { normalizeTrimmedString } from './utils.js'

function toToolPreviewItem(tool) {
  const normalizedName = normalizeTrimmedString(tool?.name)
  const normalizedSource = normalizeTrimmedString(tool?.source) || 'local'

  return {
    kind: 'tool',
    name: normalizedName,
    description: normalizeTrimmedString(tool?.description) || 'No description.',
    source: normalizedSource,
    displayPath: normalizedSource === 'mcp' ? `MCP / ${normalizedName}` : normalizedName,
    inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : {}
  }
}

function serializeToolMetadata(tool) {
  return JSON.stringify({
    name: normalizeTrimmedString(tool?.name),
    description: normalizeTrimmedString(tool?.description) || '',
    source: normalizeTrimmedString(tool?.source) || 'local',
    inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : {}
  }, null, 2)
}

export function listToolPreviewItems(toolCatalog = []) {
  return toolCatalog
    .filter((tool) => normalizeTrimmedString(tool?.name))
    .map((tool) => toToolPreviewItem(tool))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function getToolDetailItem(toolCatalog = [], toolName = '') {
  const normalizedToolName = normalizeTrimmedString(toolName)
  const tool = toolCatalog.find((item) => normalizeTrimmedString(item?.name) === normalizedToolName)

  if (!tool) {
    return null
  }

  const preview = toToolPreviewItem(tool)

  return {
    ...preview,
    metadata: serializeToolMetadata(tool)
  }
}
