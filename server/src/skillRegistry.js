import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
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

function normalizeSkill(item, index, configPath) {
  const skillId = normalizeTrimmedString(item?.skillId) || `skill_${index + 1}`
  const instruction = readInstructionText(item, configPath)

  return {
    skillId,
    name: normalizeTrimmedString(item?.name) || skillId,
    description: normalizeTrimmedString(item?.description),
    instruction,
    preferredTools: normalizeStringArray(item?.preferredTools),
    disabledTools: normalizeStringArray(item?.disabledTools),
    allowedTools: normalizeStringArray(item?.allowedTools)
  }
}

export function createSkillRegistry({
  configPath,
  defaultSkillId = ''
} = {}) {
  let skills = []
  let resolvedDefaultSkillId = normalizeTrimmedString(defaultSkillId)

  function reload() {
    const rawValue = readJsonFile(configPath)
    const items = Array.isArray(rawValue)
      ? rawValue
      : Array.isArray(rawValue?.items)
        ? rawValue.items
        : []

    skills = items.map((item, index) => normalizeSkill(item, index, configPath))
    resolvedDefaultSkillId = normalizeTrimmedString(rawValue?.defaultSkillId) || normalizeTrimmedString(defaultSkillId)
  }

  function listSkills() {
    return skills.map((item) => ({
      skillId: item.skillId,
      name: item.name,
      description: item.description,
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
