import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, parse, relative, resolve } from 'node:path'
import { normalizeTrimmedString } from './utils.js'

function ensureDirectoryExists(dirPath) {
  mkdirSync(dirPath, { recursive: true })
}

function normalizeRelativePath(rootDir, filePath) {
  const normalized = relative(rootDir, filePath).replace(/\\/g, '/')
  return normalizeTrimmedString(normalized)
}

function parseSkillMarkdownMetadata(content) {
  const metadata = {}
  const source = String(content || '').trimStart()
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const lines = (frontmatterMatch ? frontmatterMatch[1] : source).split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    if (!frontmatterMatch && trimmed.startsWith('#')) {
      break
    }

    const match = trimmed.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/)

    if (!match) {
      if (!frontmatterMatch) {
        break
      }
      continue
    }

    metadata[match[1].toLowerCase()] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }

  return metadata
}

function shouldLoadSkillMarkdown(entry) {
  if (!entry.isFile()) {
    return false
  }

  const lowerName = entry.name.toLowerCase()

  return extname(lowerName) === '.md'
    && lowerName !== 'readme.md'
}

function deriveTitleFromFile(filePath) {
  return parse(filePath).name
}

function normalizeSkillFileName(value) {
  const rawValue = normalizeTrimmedString(value).replace(/\\/g, '/')

  if (!rawValue) {
    return ''
  }

  const fileName = rawValue.toLowerCase().endsWith('.md')
    ? rawValue
    : `${rawValue}.md`

  if (
    fileName.includes('/')
    || fileName.includes('..')
    || !/^[A-Za-z0-9][A-Za-z0-9_-]*\.md$/.test(fileName)
  ) {
    return ''
  }

  return fileName
}

function createSkillFileItem(rootDir, absolutePath) {
  const content = readFileSync(absolutePath, 'utf8')
  const metadata = parseSkillMarkdownMetadata(content)
  const stats = statSync(absolutePath)
  const relativePath = normalizeRelativePath(rootDir, absolutePath)
  const fallbackTitle = deriveTitleFromFile(absolutePath)

  return {
    skillPath: relativePath,
    name: normalizeTrimmedString(metadata.name) || parse(relativePath).name,
    title: normalizeTrimmedString(metadata.title) || normalizeTrimmedString(metadata.name) || fallbackTitle,
    description: normalizeTrimmedString(metadata.description),
    contentPath: relativePath,
    contentSource: basename(absolutePath),
    hasDescription: false,
    sizeBytes: stats.size,
    updatedAt: stats.mtime.toISOString()
  }
}

function walkSkillFiles(rootDir, currentDir, items) {
  const entries = readdirSync(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const absolutePath = join(currentDir, entry.name)

    if (shouldLoadSkillMarkdown(entry)) {
      items.push(createSkillFileItem(rootDir, absolutePath))
    }
  }
}

export function createSkillLibrary({ rootDir }) {
  const resolvedRootDir = resolve(rootDir)
  ensureDirectoryExists(resolvedRootDir)

  function listSkillFiles() {
    const items = []
    walkSkillFiles(resolvedRootDir, resolvedRootDir, items)

    return items
      .sort((left, right) => left.skillPath.localeCompare(right.skillPath))
      .map((item) => ({ ...item }))
  }

  function getSkillFileDetail(skillPath) {
    const normalizedPath = normalizeTrimmedString(skillPath)

    if (!normalizedPath) {
      return null
    }

    const skillItem = listSkillFiles().find((item) => item.skillPath === normalizedPath)

    if (!skillItem) {
      return null
    }

    const absolutePath = resolve(resolvedRootDir, skillItem.contentPath)
    const content = readFileSync(absolutePath, 'utf8')

    return {
      ...skillItem,
      content,
      language: 'markdown'
    }
  }

  function createSkillFile({ fileName, content }) {
    const normalizedFileName = normalizeSkillFileName(fileName)

    if (!normalizedFileName) {
      return {
        error: 'invalid_path'
      }
    }

    const absolutePath = resolve(resolvedRootDir, normalizedFileName)
    const relativeToRoot = relative(resolvedRootDir, absolutePath)

    if (relativeToRoot.startsWith('..') || resolve(absolutePath) === resolvedRootDir) {
      return {
        error: 'invalid_path'
      }
    }

    if (existsSync(absolutePath)) {
      return {
        error: 'already_exists'
      }
    }

    writeFileSync(absolutePath, String(content ?? '').replace(/\s+$/g, '') + '\n', 'utf8')

    return {
      item: getSkillFileDetail(normalizedFileName)
    }
  }

  function updateSkillFileDetail(skillPath, content) {
    const normalizedPath = normalizeTrimmedString(skillPath)

    if (!normalizedPath) {
      return null
    }

    const skillItem = listSkillFiles().find((item) => item.skillPath === normalizedPath)

    if (!skillItem) {
      return null
    }

    const absolutePath = resolve(resolvedRootDir, skillItem.contentPath)
    const relativeToRoot = relative(resolvedRootDir, absolutePath)

    if (relativeToRoot.startsWith('..')) {
      return null
    }

    writeFileSync(absolutePath, String(content ?? ''), 'utf8')
    return getSkillFileDetail(normalizedPath)
  }

  return {
    rootDir: resolvedRootDir,
    listSkillFiles,
    createSkillFile,
    getSkillFileDetail,
    updateSkillFileDetail
  }
}
