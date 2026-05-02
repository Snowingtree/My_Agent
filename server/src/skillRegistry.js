import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
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

function readMarkdownSummary(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return ''
  }

  const content = readFileSync(filePath, 'utf8')
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

function walkSkillPackages(currentDir, items) {
  if (!existsSync(currentDir)) {
    return
  }

  const entries = readdirSync(currentDir, { withFileTypes: true })
  const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md')

  if (hasSkillFile) {
    items.push(currentDir)
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue
    }

    walkSkillPackages(join(currentDir, entry.name), items)
  }
}

function createLibrarySkillItem(packageDir) {
  const skillFilePath = join(packageDir, 'SKILL.md')

  if (!existsSync(skillFilePath)) {
    return null
  }

  const descriptionFilePath = join(packageDir, 'description.md')
  const packageName = basename(packageDir)
  const description = readMarkdownSummary(descriptionFilePath) || readMarkdownSummary(skillFilePath)

  return {
    skillId: packageName,
    name: packageName,
    description,
    instructionPath: skillFilePath,
    preferredTools: [],
    disabledTools: [],
    allowedTools: []
  }
}

function readInstructionText(item, configPath) {
  const inlineInstruction = normalizeTrimmedString(item?.instruction)

  if (inlineInstruction) {
    return inlineInstruction
  }

  const instructionPath = normalizeTrimmedString(item?.instructionPath)

  if (!instructionPath) {
    return ''
  }

  const absolutePath = isAbsolute(instructionPath)
    ? instructionPath
    : resolve(dirname(configPath), instructionPath)

  if (!existsSync(absolutePath)) {
    throw new Error(`Skill instruction file was not found: ${absolutePath}`)
  }

  return readFileSync(absolutePath, 'utf8').trim()
}

function resolveInstructionMetadata(item, configPath) {
  const inlineInstruction = normalizeTrimmedString(item?.instruction)

  if (inlineInstruction) {
    return {
      instructionPath: '',
      sourcePackage: '',
      sourceFile: ''
    }
  }

  const instructionPath = normalizeTrimmedString(item?.instructionPath)

  if (!instructionPath) {
    return {
      instructionPath: '',
      sourcePackage: '',
      sourceFile: ''
    }
  }

  const absolutePath = isAbsolute(instructionPath)
    ? instructionPath
    : resolve(dirname(configPath), instructionPath)

  return {
    instructionPath,
    sourcePackage: basename(dirname(absolutePath)),
    sourceFile: basename(absolutePath)
  }
}

function normalizeSkill(item, index, configPath) {
  const skillId = normalizeTrimmedString(item?.skillId) || `skill_${index + 1}`
  const instruction = readInstructionText(item, configPath)
  const instructionMeta = resolveInstructionMetadata(item, configPath)

  return {
    skillId,
    name: normalizeTrimmedString(item?.name) || skillId,
    description: normalizeTrimmedString(item?.description),
    instruction,
    instructionPath: instructionMeta.instructionPath,
    sourcePackage: instructionMeta.sourcePackage,
    sourceFile: instructionMeta.sourceFile,
    preferredTools: normalizeStringArray(item?.preferredTools),
    disabledTools: normalizeStringArray(item?.disabledTools),
    allowedTools: normalizeStringArray(item?.allowedTools)
  }
}

export function createSkillRegistry({
  configPath,
  defaultSkillId = '',
  libraryDir = ''
} = {}) {
  let skills = []
  let resolvedDefaultSkillId = normalizeTrimmedString(defaultSkillId)

  function reload() {
    const rawValue = readJsonFile(configPath)
    const configItems = Array.isArray(rawValue)
      ? rawValue
      : Array.isArray(rawValue?.items)
        ? rawValue.items
        : []
    const normalizedConfigItems = configItems.map((item, index) => normalizeSkill(item, index, configPath))
    const existingSkillIds = new Set(normalizedConfigItems.map((item) => item.skillId))
    const libraryPackageDirs = []

    if (normalizeTrimmedString(libraryDir)) {
      walkSkillPackages(resolve(libraryDir), libraryPackageDirs)
    }

    const normalizedLibraryItems = libraryPackageDirs
      .map((packageDir) => createLibrarySkillItem(packageDir))
      .filter(Boolean)
      .filter((item) => !existingSkillIds.has(item.skillId))
      .map((item, index) => normalizeSkill(item, normalizedConfigItems.length + index, configPath))

    skills = [...normalizedConfigItems, ...normalizedLibraryItems]
    resolvedDefaultSkillId = normalizeTrimmedString(rawValue?.defaultSkillId) || normalizeTrimmedString(defaultSkillId)
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
      hasInstruction: Boolean(item.instruction)
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

  reload()

  return {
    reload,
    listSkills,
    getSkillById,
    resolveSkill
  }
}
