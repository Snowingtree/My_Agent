import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function countOccurrences(haystack, needle) {
  if (!needle) {
    return 0
  }

  let count = 0
  let searchIndex = 0

  while (searchIndex <= haystack.length) {
    const matchIndex = haystack.indexOf(needle, searchIndex)

    if (matchIndex === -1) {
      return count
    }

    count += 1
    searchIndex = matchIndex + needle.length
  }

  return count
}

function truncatePreview(value, maxChars = 1000) {
  const normalized = String(value || '')
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}\n...truncated...`
    : normalized
}

function normalizeChanges(value) {
  return Array.isArray(value) ? value : []
}

function normalizeBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue
  }

  if (typeof value === 'boolean') {
    return value
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function replaceByOccurrence(content, find, replacement, targetOccurrence) {
  let occurrenceIndex = 0
  let searchIndex = 0
  let nextContent = ''

  while (searchIndex <= content.length) {
    const matchIndex = content.indexOf(find, searchIndex)

    if (matchIndex === -1) {
      nextContent += content.slice(searchIndex)
      break
    }

    occurrenceIndex += 1
    nextContent += content.slice(searchIndex, matchIndex)

    if (occurrenceIndex === targetOccurrence) {
      nextContent += replacement
    } else {
      nextContent += find
    }

    searchIndex = matchIndex + find.length
  }

  return nextContent
}

function resolveOccurrenceIndex({
  content,
  find,
  matchIndex,
  replaceAll,
  changeLabel
}) {
  const occurrenceCount = countOccurrences(content, find)

  if (occurrenceCount === 0) {
    throw new Error(`${changeLabel} could not find the target snippet.`)
  }

  if (replaceAll) {
    return -1
  }

  if (matchIndex !== undefined && matchIndex !== null) {
    const normalizedMatchIndex = Number.parseInt(String(matchIndex), 10)

    if (!Number.isInteger(normalizedMatchIndex) || normalizedMatchIndex <= 0) {
      throw new Error(`${changeLabel} has an invalid matchIndex. Use a positive integer.`)
    }

    if (normalizedMatchIndex > occurrenceCount) {
      throw new Error(`${changeLabel} requested matchIndex ${normalizedMatchIndex}, but only ${occurrenceCount} match(es) were found.`)
    }

    return normalizedMatchIndex
  }

  if (occurrenceCount > 1) {
    throw new Error(`${changeLabel} matched ${occurrenceCount} snippets. Add matchIndex or replaceAll to disambiguate.`)
  }

  return 1
}

function applyOccurrenceChange({
  content,
  type,
  find,
  body,
  replaceAll,
  matchIndex,
  changeLabel
}) {
  if (!find) {
    throw new Error(`${changeLabel} requires a non-empty find snippet.`)
  }

  if (replaceAll && type === 'replace') {
    return {
      nextContent: content.split(find).join(body),
      summary: `${changeLabel}: replaced all matches`
    }
  }

  if (replaceAll && type === 'delete') {
    return {
      nextContent: content.split(find).join(''),
      summary: `${changeLabel}: deleted all matches`
    }
  }

  const occurrenceIndex = resolveOccurrenceIndex({
    content,
    find,
    matchIndex,
    replaceAll,
    changeLabel
  })

  if (type === 'replace') {
    return {
      nextContent: replaceByOccurrence(content, find, body, occurrenceIndex),
      summary: `${changeLabel}: replaced match ${occurrenceIndex}`
    }
  }

  if (type === 'delete') {
    return {
      nextContent: replaceByOccurrence(content, find, '', occurrenceIndex),
      summary: `${changeLabel}: deleted match ${occurrenceIndex}`
    }
  }

  const replacement = type === 'insert_before'
    ? `${body}${find}`
    : `${find}${body}`

  return {
    nextContent: replaceByOccurrence(content, find, replacement, occurrenceIndex),
    summary: `${changeLabel}: inserted ${type === 'insert_before' ? 'before' : 'after'} match ${occurrenceIndex}`
  }
}

function findBetweenRange(content, startSnippet, endSnippet, changeLabel) {
  const startIndex = content.indexOf(startSnippet)

  if (startIndex === -1) {
    throw new Error(`${changeLabel} could not find the start snippet.`)
  }

  const searchFrom = startIndex + startSnippet.length
  const endIndex = content.indexOf(endSnippet, searchFrom)

  if (endIndex === -1) {
    throw new Error(`${changeLabel} could not find the end snippet after the start snippet.`)
  }

  return {
    startIndex,
    endIndex
  }
}

function applyBetweenChange({
  content,
  startSnippet,
  endSnippet,
  body,
  includeDelimiters,
  changeLabel
}) {
  if (!startSnippet || !endSnippet) {
    throw new Error(`${changeLabel} requires both start and end snippets.`)
  }

  const { startIndex, endIndex } = findBetweenRange(content, startSnippet, endSnippet, changeLabel)
  const startBoundary = includeDelimiters ? startIndex : startIndex + startSnippet.length
  const endBoundary = includeDelimiters ? endIndex + endSnippet.length : endIndex

  return {
    nextContent: `${content.slice(0, startBoundary)}${body}${content.slice(endBoundary)}`,
    summary: `${changeLabel}: replaced content between markers`
  }
}

function applySingleChange(content, change, index) {
  const type = String(change?.type || 'replace').trim().toLowerCase()
  const changeLabel = `Change #${index + 1}`
  const body = String(change?.content ?? change?.replace ?? '')
  const replaceAll = normalizeBoolean(change?.replaceAll)

  if (type === 'append') {
    return {
      nextContent: `${content}${body}`,
      summary: `${changeLabel}: appended content`
    }
  }

  if (type === 'prepend') {
    return {
      nextContent: `${body}${content}`,
      summary: `${changeLabel}: prepended content`
    }
  }

  if (type === 'replace_between') {
    return applyBetweenChange({
      content,
      startSnippet: String(change?.start ?? ''),
      endSnippet: String(change?.end ?? ''),
      body,
      includeDelimiters: normalizeBoolean(change?.includeDelimiters),
      changeLabel
    })
  }

  if (!['replace', 'insert_before', 'insert_after', 'delete'].includes(type)) {
    throw new Error(`${changeLabel} has unsupported type "${type}".`)
  }

  return applyOccurrenceChange({
    content,
    type,
    find: String(change?.find ?? ''),
    body,
    replaceAll,
    matchIndex: change?.matchIndex,
    changeLabel
  })
}

export function createApplyPatchTool({ workspace, workspaceConfig } = {}) {
  return {
    name: 'apply_patch',
    description: 'Apply targeted text edits to an existing file. Supports replace, insert_before, insert_after, delete, append, prepend, and replace_between.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path inside the workspace.' },
        changes: {
          type: 'array',
          description: 'Ordered text edits. Supported types: replace, insert_before, insert_after, delete, append, prepend, replace_between.'
        },
        createIfMissing: { type: 'boolean', description: 'Create the file if it does not exist. Defaults to false.' }
      },
      required: ['path', 'changes']
    },
    async run(args = {}) {
      if (!workspaceConfig.enableWriteTools) {
        throw new Error('apply_patch is disabled on this server. Enable AGENT_ENABLE_WRITE_TOOLS to allow file changes.')
      }

      const target = workspace.resolvePath(args.path)
      const changes = normalizeChanges(args.changes)
      const createIfMissing = args.createIfMissing === true

      if (!changes.length) {
        throw new Error('apply_patch requires at least one change.')
      }

      let content = ''
      let existed = true

      try {
        content = await readFile(target.absolutePath, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error
        }

        if (!createIfMissing) {
          throw new Error(`The file ${target.relativePath} does not exist.`)
        }

        existed = false
      }

      const changeSummaries = []
      let nextContent = content

      changes.forEach((change, index) => {
        const changeType = String(change?.type || 'replace').trim().toLowerCase()
        const changeFind = String(change?.find ?? '')
        const isWholeFileCreation =
          !existed
          && createIfMissing
          && changeType === 'replace'
          && !changeFind
          && changes.length === 1

        if (isWholeFileCreation) {
          const body = String(change?.content ?? change?.replace ?? '')
          nextContent = body
          changeSummaries.push(`Change #${index + 1}: created the file with full content`)
          return
        }

        const applied = applySingleChange(nextContent, change, index)
        nextContent = applied.nextContent
        changeSummaries.push(applied.summary)
      })

      if (Buffer.byteLength(nextContent, 'utf8') > workspaceConfig.maxWriteSizeBytes) {
        throw new Error(`The patched file exceeds the write size limit of ${workspaceConfig.maxWriteSizeBytes} bytes.`)
      }

      await mkdir(dirname(target.absolutePath), { recursive: true })
      await writeFile(target.absolutePath, nextContent, 'utf8')

      return {
        path: target.relativePath,
        existed,
        changed: nextContent !== content || !existed,
        sizeBytes: Buffer.byteLength(nextContent, 'utf8'),
        changeCount: changes.length,
        changeSummaries,
        preview: truncatePreview(nextContent)
      }
    },
    summarize(result) {
      return `Applied ${result.changeCount} patch change(s) to ${result.path}.`
    },
    formatMessage(result) {
      return [
        'Tool: apply_patch',
        `Path: ${result.path}`,
        `Changes: ${result.changeCount}`,
        '',
        'Applied edits:',
        ...result.changeSummaries,
        '',
        'Preview:',
        result.preview
      ].join('\n')
    }
  }
}
