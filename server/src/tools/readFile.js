import { open } from 'node:fs/promises'

function hasBinaryContent(buffer) {
  return buffer.includes(0)
}

function truncatePreview(value, maxChars = 1000) {
  const normalized = String(value || '')
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}\n...truncated...`
    : normalized
}

export function createReadFileTool({ workspace, workspaceConfig } = {}) {
  return {
    name: 'read_file',
    description: '从工作区读取文本文件。适用于源代码、配置文件和日志。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工作区内的相对文件路径。' }
      },
      required: ['path']
    },
    async run(args = {}) {
      const target = workspace.resolvePath(args.path)
      const fileHandle = await open(target.absolutePath, 'r')

      try {
        const fileStat = await fileHandle.stat()

        if (!fileStat.isFile()) {
          throw new Error('The requested path is not a file.')
        }

        const maxBytes = workspaceConfig.maxFileSizeBytes
        const bytesToRead = Math.min(fileStat.size, maxBytes)
        const buffer = Buffer.alloc(bytesToRead)
        const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, 0)
        const contentBuffer = buffer.subarray(0, bytesRead)

        if (hasBinaryContent(contentBuffer)) {
          throw new Error('The requested file appears to be binary and cannot be read as text.')
        }

        return {
          path: target.relativePath,
          content: contentBuffer.toString('utf8'),
          truncated: fileStat.size > maxBytes,
          sizeBytes: fileStat.size
        }
      } finally {
        await fileHandle.close()
      }
    },
    summarize(result) {
      return `Read ${result.path}${result.truncated ? ' (truncated)' : ''}.`
    },
    formatMessage(result) {
      return [
        'Tool: read_file',
        `Path: ${result.path}`,
        `Size: ${result.sizeBytes} bytes${result.truncated ? ' (truncated)' : ''}`,
        '',
        'Preview:',
        truncatePreview(result.content)
      ].join('\n')
    }
  }
}
