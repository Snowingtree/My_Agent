import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeTrimmedString } from './utils.js'

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url)
const CURRENT_DIR_PATH = dirname(CURRENT_FILE_PATH)

const BUILTIN_TOOL_SOURCE_MAP = new Map([
  ['list_files', { relativePath: 'server/src/tools/listFiles.js', absolutePath: join(CURRENT_DIR_PATH, 'tools', 'listFiles.js'), language: 'javascript' }],
  ['read_file', { relativePath: 'server/src/tools/readFile.js', absolutePath: join(CURRENT_DIR_PATH, 'tools', 'readFile.js'), language: 'javascript' }],
  ['search_text', { relativePath: 'server/src/tools/searchText.js', absolutePath: join(CURRENT_DIR_PATH, 'tools', 'searchText.js'), language: 'javascript' }],
  ['run_command', { relativePath: 'server/src/tools/runCommand.js', absolutePath: join(CURRENT_DIR_PATH, 'tools', 'runCommand.js'), language: 'javascript' }],
  ['write_file', { relativePath: 'server/src/tools/writeFile.js', absolutePath: join(CURRENT_DIR_PATH, 'tools', 'writeFile.js'), language: 'javascript' }],
  ['apply_patch', { relativePath: 'server/src/tools/applyPatch.js', absolutePath: join(CURRENT_DIR_PATH, 'tools', 'applyPatch.js'), language: 'javascript' }]
])

function toToolPreviewItem(tool) {
  const normalizedName = normalizeTrimmedString(tool?.name)
  const normalizedSource = normalizeTrimmedString(tool?.source) || 'local'
  const sourceMeta = BUILTIN_TOOL_SOURCE_MAP.get(normalizedName)

  return {
    name: normalizedName,
    description: normalizeTrimmedString(tool?.description) || 'No description.',
    source: normalizedSource,
    language: sourceMeta?.language || 'json',
    displayPath: sourceMeta?.relativePath || (normalizedSource === 'mcp' ? `MCP / ${normalizedName}` : normalizedName),
    hasSourceCode: Boolean(sourceMeta)
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
  const sourceMeta = BUILTIN_TOOL_SOURCE_MAP.get(normalizedToolName)

  if (sourceMeta) {
    const content = await readFile(sourceMeta.absolutePath, 'utf8')

    return {
      ...preview,
      content
    }
  }

  return {
    ...preview,
    content: serializeToolMetadata(tool)
  }
}
