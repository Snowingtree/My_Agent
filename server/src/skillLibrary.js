import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { normalizeTrimmedString } from './utils.js'

function ensureDirectoryExists(dirPath) {
  mkdirSync(dirPath, { recursive: true })
}

function normalizeRelativePath(rootDir, filePath) {
  const normalized = relative(rootDir, filePath).replace(/\\/g, '/')
  return normalizeTrimmedString(normalized)
}

function walkSkillPackages(rootDir, currentDir, items) {
  const entries = readdirSync(currentDir, { withFileTypes: true })
  const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md')

  if (hasSkillFile) {
    const skillAbsolutePath = join(currentDir, 'SKILL.md')
    const descriptionAbsolutePath = join(currentDir, 'description.md')
    const preferredContentPath = existsSync(descriptionAbsolutePath) ? descriptionAbsolutePath : skillAbsolutePath
    const stats = statSync(preferredContentPath)
    const relativePackagePath = normalizeRelativePath(rootDir, currentDir)

    items.push({
      skillPath: relativePackagePath || '.',
      name: basename(currentDir),
      title: basename(currentDir),
      contentPath: normalizeRelativePath(rootDir, preferredContentPath),
      contentSource: existsSync(descriptionAbsolutePath) ? 'description.md' : 'SKILL.md',
      hasDescription: existsSync(descriptionAbsolutePath),
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString()
    })
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const absolutePath = join(currentDir, entry.name)

    if (entry.isDirectory()) {
      walkSkillPackages(rootDir, absolutePath, items)
    }
  }
}

export function createSkillLibrary({ rootDir }) {
  const resolvedRootDir = resolve(rootDir)
  ensureDirectoryExists(resolvedRootDir)

  function listSkillFiles() {
    const items = []
    walkSkillPackages(resolvedRootDir, resolvedRootDir, items)

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

  return {
    rootDir: resolvedRootDir,
    listSkillFiles,
    getSkillFileDetail
  }
}
