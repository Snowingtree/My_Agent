import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, parse, resolve } from 'node:path'
import { normalizeTrimmedString } from './utils.js'

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null
  }

  const rawValue = readFileSync(filePath, 'utf8').trim()

  if (!rawValue) {
    return null
  }

  return JSON.parse(rawValue)
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(
    value
      .map((item) => normalizeTrimmedString(item))
      .filter(Boolean)
  )]
}

function readSkillHeaderText(filePath, {
  maxBytes = 16 * 1024,
  maxLines = 50
} = {}) {
  if (!filePath || !existsSync(filePath)) {
    return ''
  }

  const fileDescriptor = openSync(filePath, 'r')

  try {
    const buffer = Buffer.alloc(maxBytes)
    const bytesRead = readSync(fileDescriptor, buffer, 0, maxBytes, 0)

    return buffer
      .toString('utf8', 0, bytesRead)
      .split(/\r?\n/)
      .slice(0, maxLines)
      .join('\n')
  } finally {
    closeSync(fileDescriptor)
  }
}

function readMarkdownSummary(filePath) {
  const content = readSkillHeaderText(filePath)

  if (!content) {
    return ''
  }

  const metadata = parseSkillMarkdownMetadata(content)

  if (metadata.description) {
    return metadata.description
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const summaryLine = lines.find((line) => !/^#/.test(line)) || lines[0] || ''

  return summaryLine
    .replace(/^#+\s*/, '')
    .replace(/[`*_~]/g, '')
    .trim()
}

function parseSkillMarkdownMetadata(content) {
  const metadata = {}
  const lines = String(content || '').split(/\r?\n/)
  let index = 0

  if (lines[index]?.trim() === '---') {
    index += 1
    for (; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (line === '---') {
        break
      }
      const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/)
      if (match) {
        metadata[match[1].toLowerCase()] = match[2].trim().replace(/^['"]|['"]$/g, '')
      }
    }
    return metadata
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    if (trimmed.startsWith('#')) {
      break
    }

    const match = trimmed.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/)

    if (!match) {
      break
    }

    metadata[match[1].toLowerCase()] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }

  return metadata
}

function deriveSkillIdFromMarkdownPath(filePath) {
  return parse(filePath).name
}

function shouldLoadSkillFile(entry) {
  if (!entry.isFile()) {
    return false
  }

  const lowerName = entry.name.toLowerCase()

  return extname(lowerName) === '.md'
    && lowerName !== 'readme.md'
}

function listSkillSources(skillsDir) {
  if (!existsSync(skillsDir)) {
    return []
  }

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => shouldLoadSkillFile(entry))
    .map((entry) => resolve(skillsDir, entry.name))
}

function createLibrarySkillItem(skillFilePath) {
  if (!existsSync(skillFilePath)) {
    return null
  }

  const content = readSkillHeaderText(skillFilePath)
  const metadata = parseSkillMarkdownMetadata(content)
  const skillId = normalizeTrimmedString(metadata.name) || deriveSkillIdFromMarkdownPath(skillFilePath)
  const name = normalizeTrimmedString(metadata.title) || skillId
  const description = normalizeTrimmedString(metadata.description) || readMarkdownSummary(skillFilePath)

  return {
    skillId,
    name,
    description,
    instructionPath: skillFilePath,
    preferredTools: [],
    disabledTools: [],
    allowedTools: []
  }
}

function resolveInstructionMetadata(item, configPath) {
  const inlineInstruction = normalizeTrimmedString(item?.instruction)

  if (inlineInstruction) {
    return {
      instructionPath: '',
      absoluteInstructionPath: '',
      sourcePackage: '',
      sourceFile: '',
      hasInstruction: true
    }
  }

  const instructionPath = normalizeTrimmedString(item?.instructionPath)

  if (!instructionPath) {
    return {
      instructionPath: '',
      absoluteInstructionPath: '',
      sourcePackage: '',
      sourceFile: '',
      hasInstruction: false
    }
  }

  const absolutePath = isAbsolute(instructionPath)
    ? instructionPath
    : resolve(dirname(configPath), instructionPath)

  return {
    instructionPath,
    absoluteInstructionPath: absolutePath,
    sourcePackage: basename(dirname(absolutePath)),
    sourceFile: basename(absolutePath),
    hasInstruction: existsSync(absolutePath)
  }
}

function normalizeSkill(item, index, configPath) {
  const skillId = normalizeTrimmedString(item?.skillId) || `skill_${index + 1}`
  const instructionMeta = resolveInstructionMetadata(item, configPath)

  return {
    skillId,
    name: normalizeTrimmedString(item?.name) || skillId,
    description: normalizeTrimmedString(item?.description),
    instructionPath: instructionMeta.instructionPath,
    absoluteInstructionPath: instructionMeta.absoluteInstructionPath,
    sourcePackage: instructionMeta.sourcePackage,
    sourceFile: instructionMeta.sourceFile,
    inlineInstruction: normalizeTrimmedString(item?.instruction),
    hasInstruction: instructionMeta.hasInstruction,
    preferredTools: normalizeStringArray(item?.preferredTools),
    disabledTools: normalizeStringArray(item?.disabledTools),
    allowedTools: normalizeStringArray(item?.allowedTools)
  }
}

const SKILL_INSTRUCTION_CACHE_LIMIT = 32

function touchInstructionCache(cache, cacheKey, value) {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey)
  }

  cache.set(cacheKey, value)

  while (cache.size > SKILL_INSTRUCTION_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value
    cache.delete(oldestKey)
  }
}

export function createSkillRegistry({
  configPath,
  defaultSkillId = '',
  libraryDir = ''
} = {}) {
  let skills = []
  let resolvedDefaultSkillId = normalizeTrimmedString(defaultSkillId)
  const instructionCache = new Map()

  function reload() {
    const rawValue = readJsonFile(configPath)
    const configItems = Array.isArray(rawValue)
      ? rawValue
      : Array.isArray(rawValue?.items)
        ? rawValue.items
        : []
    const normalizedConfigItems = configItems.map((item, index) => normalizeSkill(item, index, configPath))
    const existingSkillIds = new Set(normalizedConfigItems.map((item) => item.skillId))
    const librarySkillFiles = normalizeTrimmedString(libraryDir)
      ? listSkillSources(resolve(libraryDir))
      : []

    const normalizedLibraryItems = librarySkillFiles
      .map((skillFilePath) => createLibrarySkillItem(skillFilePath))
      .filter(Boolean)
      .filter((item) => !existingSkillIds.has(item.skillId))
      .map((item, index) => normalizeSkill(item, normalizedConfigItems.length + index, configPath))

    skills = [...normalizedConfigItems, ...normalizedLibraryItems]
    resolvedDefaultSkillId = normalizeTrimmedString(rawValue?.defaultSkillId) || normalizeTrimmedString(defaultSkillId)
    instructionCache.clear()
  }

  function listSkills() {
    return skills.map((item) => ({
      skillId: item.skillId,
      name: item.name,
      description: item.description,
      instructionPath: item.instructionPath,
      sourcePackage: item.sourcePackage,
      sourceFile: item.sourceFile,
      preferredTools: [...item.preferredTools],
      disabledTools: [...item.disabledTools],
      allowedTools: [...item.allowedTools],
      hasInstruction: item.hasInstruction
    }))
  }

  function getSkillById(skillId) {
    const normalizedSkillId = normalizeTrimmedString(skillId)

    if (!normalizedSkillId) {
      return null
    }

    return skills.find((item) => item.skillId === normalizedSkillId) || null
  }

  function resolveSkill(skillId) {
    return (
      getSkillById(skillId)
      || getSkillById(resolvedDefaultSkillId)
      || skills[0]
      || null
    )
  }

  function loadSkillInstruction(skillId) {
    const skill = getSkillById(skillId)

    if (!skill) {
      return ''
    }

    if (skill.inlineInstruction) {
      return skill.inlineInstruction
    }

    const absolutePath = normalizeTrimmedString(skill.absoluteInstructionPath)

    if (!absolutePath || !existsSync(absolutePath)) {
      return ''
    }

    const stats = statSync(absolutePath)
    const cacheKey = `${absolutePath}:${stats.mtimeMs}:${stats.size}`
    const cachedValue = instructionCache.get(cacheKey)

    if (cachedValue) {
      touchInstructionCache(instructionCache, cacheKey, cachedValue)
      return cachedValue
    }

    const instruction = readFileSync(absolutePath, 'utf8').trim()
    touchInstructionCache(instructionCache, cacheKey, instruction)

    return instruction
  }

  reload()

  return {
    reload,
    listSkills,
    getSkillById,
    resolveSkill,
    loadSkillInstruction
  }
}
