import { readdir } from 'node:fs/promises'

const DEFAULT_IGNORED_DIR_NAMES = new Set(['.git', 'node_modules', 'dist'])

function readPositiveInteger(value, fallbackValue, maxValue) {
  const parsedValue = Number.parseInt(String(value ?? ''), 10)

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallbackValue
  }

  return Math.min(parsedValue, maxValue)
}

function formatEntryList(entries, maxEntries = 12) {
  const lines = entries
    .slice(0, maxEntries)
    .map((entry) => `${entry.type === 'directory' ? '[dir]' : '[file]'} ${entry.path}`)

  if (entries.length > maxEntries) {
    lines.push('...truncated...')
  }

  return lines.join('\n')
}

export function createListFilesTool({ workspace } = {}) {
  return {
    name: 'list_files',
    description: 'List files and directories under the workspace. Use this first to understand project structure.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path inside the workspace. Defaults to ".".' },
        maxDepth: { type: 'integer', description: 'Maximum recursion depth from 1 to 6. Defaults to 2.' },
        limit: { type: 'integer', description: 'Maximum number of returned entries from 1 to 400. Defaults to 200.' }
      }
    },
    async run(args = {}) {
      const target = workspace.resolvePath(args.path || '.')
      const maxDepth = readPositiveInteger(args.maxDepth, 2, 6)
      const limit = readPositiveInteger(args.limit, 200, 400)
      const entries = []
      let truncated = false

      async function walk(absoluteDirPath, depth) {
        if (entries.length >= limit) {
          truncated = true
          return
        }

        const dirEntries = await readdir(absoluteDirPath, { withFileTypes: true })
        dirEntries.sort((left, right) => left.name.localeCompare(right.name))

        for (const entry of dirEntries) {
          if (entries.length >= limit) {
            truncated = true
            return
          }

          const child = workspace.resolvePath(`${workspace.toRelativePath(absoluteDirPath)}/${entry.name}`)
          const type = entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : entry.isSymbolicLink()
                ? 'symlink'
                : 'other'

          entries.push({
            path: child.relativePath,
            type
          })

          if (
            type === 'directory'
            && depth < maxDepth
            && !DEFAULT_IGNORED_DIR_NAMES.has(entry.name)
          ) {
            await walk(child.absolutePath, depth + 1)
          }
        }
      }

      await walk(target.absolutePath, 1)

      return {
        path: target.relativePath,
        maxDepth,
        limit,
        entries,
        truncated
      }
    },
    summarize(result) {
      return `Listed ${result.entries.length} item(s) under ${result.path}${result.truncated ? ' (truncated)' : ''}.`
    },
    formatMessage(result) {
      return [
        'Tool: list_files',
        `Path: ${result.path}`,
        `Entries: ${result.entries.length}${result.truncated ? ' (truncated)' : ''}`,
        '',
        formatEntryList(result.entries)
      ].join('\n')
    }
  }
}
