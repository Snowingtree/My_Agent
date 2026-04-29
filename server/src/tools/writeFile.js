import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function normalizeBoolean(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true'
}

function truncatePreview(value, maxChars = 800) {
  const normalized = String(value || '')
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}\n...truncated...`
    : normalized
}

export function createWriteFileTool({ workspace, workspaceConfig } = {}) {
  return {
    name: 'write_file',
    description: 'Create or fully replace a text file in the workspace. Use for new files or when rewriting an entire file is simpler than patching.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path inside the workspace.' },
        content: { type: 'string', description: 'Full file content to write.' },
        createDirectories: { type: 'boolean', description: 'Create parent directories automatically. Defaults to true.' }
      },
      required: ['path', 'content']
    },
    async run(args = {}) {
      if (!workspaceConfig.enableWriteTools) {
        throw new Error('write_file is disabled on this server. Enable AGENT_ENABLE_WRITE_TOOLS to allow file changes.')
      }

      const target = workspace.resolvePath(args.path)
      const content = String(args.content ?? '')
      const createDirectories = args.createDirectories === undefined
        ? true
        : normalizeBoolean(args.createDirectories)

      if (Buffer.byteLength(content, 'utf8') > workspaceConfig.maxWriteSizeBytes) {
        throw new Error(`The requested file content exceeds the write size limit of ${workspaceConfig.maxWriteSizeBytes} bytes.`)
      }

      let previousContent = ''
      let existed = true

      try {
        previousContent = await readFile(target.absolutePath, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error
        }

        existed = false
      }

      if (createDirectories) {
        await mkdir(dirname(target.absolutePath), { recursive: true })
      }

      await writeFile(target.absolutePath, content, 'utf8')

      return {
        path: target.relativePath,
        existed,
        changed: !existed || previousContent !== content,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        preview: truncatePreview(content)
      }
    },
    summarize(result) {
      return `${result.changed ? 'Wrote' : 'Verified unchanged'} ${result.path}.`
    },
    formatMessage(result) {
      return [
        `Tool: write_file`,
        `Path: ${result.path}`,
        `Status: ${result.changed ? 'updated' : 'unchanged'}`,
        '',
        'Preview:',
        result.preview
      ].join('\n')
    }
  }
}
