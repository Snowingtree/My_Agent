import { readdir, readFile, stat } from 'node:fs/promises'

const DEFAULT_IGNORED_DIR_NAMES = new Set(['.git', 'node_modules', 'dist'])

function hasBinaryContent(buffer) {
  return buffer.includes(0)
}

function formatMatches(matches, maxEntries = 8) {
  const lines = matches
    .slice(0, maxEntries)
    .map((match) => `${match.path}:${match.lineNumber} ${match.line}`)

  if (matches.length > maxEntries) {
    lines.push('...truncated...')
  }

  return lines.join('\n')
}

function normalizeBoolean(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true'
}

export function createSearchTextTool({ workspace, workspaceConfig } = {}) {
  return {
    name: 'search_text',
    description: '在工作区文件中搜索纯文本。用于定位符号、字符串和用法。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的纯文本。' },
        path: { type: 'string', description: '相对文件或目录路径。默认为 "."。' },
        caseSensitive: { type: 'boolean', description: '是否区分大小写。默认为 false。' },
        limit: { type: 'integer', description: '返回的最大匹配数。默认为服务器配置的限制。' }
      },
      required: ['query']
    },
    async run(args = {}) {
      const query = String(args.query || '')

      if (!query.trim()) {
        throw new Error('search_text requires a non-empty query.')
      }

      const target = workspace.resolvePath(args.path || '.')
      const caseSensitive = normalizeBoolean(args.caseSensitive)
      const normalizedNeedle = caseSensitive ? query : query.toLowerCase()
      const limit = Math.min(
        Number.parseInt(String(args.limit ?? workspaceConfig.maxSearchResults), 10) || workspaceConfig.maxSearchResults,
        workspaceConfig.maxSearchResults
      )
      const matches = []
      let scannedFiles = 0
      let truncated = false

      async function inspectFile(relativePath) {
        if (matches.length >= limit) {
          truncated = true
          return
        }

        const fileTarget = workspace.resolvePath(relativePath)
        const fileStat = await stat(fileTarget.absolutePath)

        if (!fileStat.isFile()) {
          return
        }

        const bytesToRead = Math.min(fileStat.size, workspaceConfig.maxFileSizeBytes)
        const contentBuffer = await readFile(fileTarget.absolutePath)
        const textBuffer = contentBuffer.subarray(0, bytesToRead)

        if (hasBinaryContent(textBuffer)) {
          return
        }

        scannedFiles += 1
        const lines = textBuffer.toString('utf8').split(/\r?\n/)

        for (let index = 0; index < lines.length; index += 1) {
          if (matches.length >= limit) {
            truncated = true
            return
          }

          const line = lines[index]
          const haystack = caseSensitive ? line : line.toLowerCase()

          if (!haystack.includes(normalizedNeedle)) {
            continue
          }

          matches.push({
            path: fileTarget.relativePath,
            lineNumber: index + 1,
            line
          })
        }
      }

      async function walk(relativePath) {
        if (matches.length >= limit) {
          truncated = true
          return
        }

        const currentTarget = workspace.resolvePath(relativePath)
        const currentStat = await stat(currentTarget.absolutePath)

        if (currentStat.isFile()) {
          await inspectFile(currentTarget.relativePath)
          return
        }

        const dirEntries = await readdir(currentTarget.absolutePath, { withFileTypes: true })
        dirEntries.sort((left, right) => left.name.localeCompare(right.name))

        for (const entry of dirEntries) {
          if (matches.length >= limit) {
            truncated = true
            return
          }

          const childRelativePath = currentTarget.relativePath === '.'
            ? entry.name
            : `${currentTarget.relativePath}/${entry.name}`

          if (entry.isDirectory()) {
            if (DEFAULT_IGNORED_DIR_NAMES.has(entry.name)) {
              continue
            }

            await walk(childRelativePath)
            continue
          }

          if (entry.isFile()) {
            await inspectFile(childRelativePath)
          }
        }
      }

      await walk(target.relativePath)

      return {
        query,
        path: target.relativePath,
        caseSensitive,
        limit,
        scannedFiles,
        matches,
        truncated
      }
    },
    summarize(result) {
      return `Found ${result.matches.length} match(es) for "${result.query}" under ${result.path}${result.truncated ? ' (truncated)' : ''}.`
    },
    formatMessage(result) {
      return [
        'Tool: search_text',
        `Query: ${result.query}`,
        `Path: ${result.path}`,
        `Matches: ${result.matches.length}${result.truncated ? ' (truncated)' : ''}`,
        '',
        formatMatches(result.matches)
      ].join('\n')
    }
  }
}
