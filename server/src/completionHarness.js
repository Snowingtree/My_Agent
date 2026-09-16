const CONTRACT_VERSION = 1
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2
const MAX_EVIDENCE_EVENTS = 200

export const COMPLETION_STATUS = Object.freeze({
  PASSED: 'passed',
  REPAIRABLE: 'repairable',
  FAILED: 'failed'
})

function normalizeString(value) {
  return String(value ?? '').trim()
}

function normalizeStringArray(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeString(value))
      .filter(Boolean)
  )]
}

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback
  }

  return Math.floor(numericValue)
}

function normalizeTimestamp(value) {
  const normalized = normalizeString(value)

  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    return ''
  }

  return normalized
}

function criterion(id, description, repairInstruction, { retryable = true, metadata = {} } = {}) {
  return {
    id,
    description,
    repairInstruction,
    retryable,
    metadata
  }
}

export function createCompletionContract({
  taskId = '',
  goal = '',
  createdAt = new Date().toISOString(),
  requiresWorkspaceInspection = false,
  requiresWorkspaceChange = false,
  enforceReadOnlyWorkspace = false,
  verificationAvailable = false,
  requiredCompanionExtensions = [],
  requiredSkillIds = [],
  requiresUserProfileMemory = false,
  maxRepairAttempts = DEFAULT_MAX_REPAIR_ATTEMPTS
} = {}) {
  const normalizedExtensions = normalizeStringArray(requiredCompanionExtensions)
    .map((extension) => extension.toLowerCase())
  const normalizedSkillIds = normalizeStringArray(requiredSkillIds)
  const criteria = []

  if (normalizedSkillIds.length) {
    criteria.push(criterion(
      'required_skills_active',
      'Every manually selected Skill must be active.',
      `Load help and activate these Skills before finishing: ${normalizedSkillIds.join(', ')}.`,
      { metadata: { skillIds: normalizedSkillIds } }
    ))
  }

  if (requiresUserProfileMemory) {
    criteria.push(criterion(
      'user_profile_updated',
      'The requested durable user profile memory must be saved.',
      'Save the complete merged user profile before finishing.'
    ))
  }

  if (requiresWorkspaceInspection) {
    criteria.push(criterion(
      'workspace_inspected',
      'The workspace must be inspected before completion.',
      'Inspect the relevant workspace files before finishing.'
    ))
  }

  if (requiresWorkspaceChange) {
    criteria.push(criterion(
      'workspace_changed',
      'The task must produce a real workspace change.',
      'Make the requested workspace change, or ask one blocking clarification question.'
    ))
  }

  if (enforceReadOnlyWorkspace) {
    criteria.push(criterion(
      'workspace_unchanged',
      'A read-only task must not modify the workspace.',
      'The workspace was modified during a read-only task. Stop and report the boundary violation.',
      { retryable: false }
    ))
  }

  if (normalizedExtensions.length) {
    criteria.push(criterion(
      'companion_files_changed',
      'All requested companion file types must be changed.',
      `Create or update companion files with these extensions: ${normalizedExtensions.join(', ')}.`,
      { metadata: { extensions: normalizedExtensions } }
    ))
  }

  if (requiresWorkspaceChange && verificationAvailable) {
    criteria.push(criterion(
      'workspace_change_verified',
      'The final workspace state must pass verification after the latest change.',
      'Run the configured verification after the latest workspace change and fix any failure.'
    ))
  }

  return {
    version: CONTRACT_VERSION,
    taskId: normalizeString(taskId),
    goal: normalizeString(goal),
    createdAt: normalizeTimestamp(createdAt) || new Date().toISOString(),
    maxRepairAttempts: normalizePositiveInteger(maxRepairAttempts, DEFAULT_MAX_REPAIR_ATTEMPTS),
    criteria
  }
}

export function createCompletionEvidence(initial = {}) {
  const source = initial && typeof initial === 'object' ? initial : {}
  const workspace = source.workspace && typeof source.workspace === 'object' ? source.workspace : {}
  const verification = source.verification && typeof source.verification === 'object' ? source.verification : {}
  const events = Array.isArray(source.events) ? source.events : []

  return {
    startedAt: normalizeTimestamp(source.startedAt) || new Date().toISOString(),
    events: events.slice(-MAX_EVIDENCE_EVENTS).map((event) => ({
      type: normalizeString(event?.type),
      at: normalizeTimestamp(event?.at),
      tool: normalizeString(event?.tool),
      status: normalizeString(event?.status),
      path: normalizeString(event?.path)
    })).filter((event) => event.type),
    workspace: {
      inspected: Boolean(workspace.inspected),
      modified: Boolean(workspace.modified),
      changedFiles: normalizeStringArray(workspace.changedFiles),
      lastMutationAt: normalizeTimestamp(workspace.lastMutationAt)
    },
    verification: {
      available: Boolean(verification.available),
      attempted: Boolean(verification.attempted),
      passed: Boolean(verification.passed),
      failed: Boolean(verification.failed),
      lastAttemptAt: normalizeTimestamp(verification.lastAttemptAt),
      lastPassedAt: normalizeTimestamp(verification.lastPassedAt)
    },
    activeSkillIds: normalizeStringArray(source.activeSkillIds),
    userProfileUpdated: Boolean(source.userProfileUpdated)
  }
}

export function recordCompletionEvidence(evidence, event = {}) {
  const next = createCompletionEvidence(evidence)
  const type = normalizeString(event.type)
  const at = normalizeTimestamp(event.at) || new Date().toISOString()

  if (!type) {
    return next
  }

  next.events = [
    ...next.events,
    {
      type,
      at,
      tool: normalizeString(event.tool),
      status: normalizeString(event.status),
      path: normalizeString(event.path)
    }
  ].slice(-MAX_EVIDENCE_EVENTS)

  if (type === 'workspace.inspected') {
    next.workspace.inspected = true
  } else if (type === 'workspace.modified') {
    next.workspace.modified = true
    next.workspace.lastMutationAt = at
    next.workspace.changedFiles = normalizeStringArray([
      ...next.workspace.changedFiles,
      event.path
    ])
    next.verification.passed = false
    next.verification.failed = false
    next.verification.lastPassedAt = ''
  } else if (type === 'verification.started') {
    next.verification.available = true
    next.verification.attempted = true
    next.verification.lastAttemptAt = at
  } else if (type === 'verification.passed') {
    next.verification.available = true
    next.verification.attempted = true
    next.verification.passed = true
    next.verification.failed = false
    next.verification.lastAttemptAt = at
    next.verification.lastPassedAt = at
  } else if (type === 'verification.failed') {
    next.verification.available = true
    next.verification.attempted = true
    next.verification.passed = false
    next.verification.failed = true
    next.verification.lastAttemptAt = at
  } else if (type === 'skill.activated') {
    next.activeSkillIds = normalizeStringArray([...next.activeSkillIds, event.skillId])
  } else if (type === 'user_profile.updated') {
    next.userProfileUpdated = true
  }

  return next
}

function isAtOrAfter(candidate, reference) {
  const candidateTime = Date.parse(candidate || '')
  const referenceTime = Date.parse(reference || '')

  if (!Number.isFinite(candidateTime)) {
    return false
  }

  return !Number.isFinite(referenceTime) || candidateTime >= referenceTime
}

function evaluateCriterion(item, evidence) {
  if (item.id === 'required_skills_active') {
    const activeSkillIds = new Set(evidence.activeSkillIds)
    return item.metadata.skillIds.every((skillId) => activeSkillIds.has(skillId))
  }

  if (item.id === 'user_profile_updated') {
    return evidence.userProfileUpdated
  }

  if (item.id === 'workspace_inspected') {
    return evidence.workspace.inspected
  }

  if (item.id === 'workspace_changed') {
    return evidence.workspace.modified && evidence.workspace.changedFiles.length > 0
  }

  if (item.id === 'workspace_unchanged') {
    return !evidence.workspace.modified
  }

  if (item.id === 'companion_files_changed') {
    const changedFiles = evidence.workspace.changedFiles.map((filePath) => filePath.toLowerCase())
    return item.metadata.extensions.every((extension) => (
      changedFiles.some((filePath) => filePath.endsWith(extension))
    ))
  }

  if (item.id === 'workspace_change_verified') {
    return (
      evidence.verification.passed
      && isAtOrAfter(evidence.verification.lastPassedAt, evidence.workspace.lastMutationAt)
    )
  }

  return false
}

export function evaluateCompletion(contract, evidence, { evaluatedAt = new Date().toISOString() } = {}) {
  const normalizedEvidence = createCompletionEvidence(evidence)
  const criteria = (Array.isArray(contract?.criteria) ? contract.criteria : []).map((item) => {
    const passed = evaluateCriterion(item, normalizedEvidence)

    return {
      id: item.id,
      description: item.description,
      passed,
      retryable: item.retryable !== false,
      repairInstruction: item.repairInstruction,
      metadata: item.metadata || {}
    }
  })
  const failedCriteria = criteria.filter((item) => !item.passed)
  const status = failedCriteria.length === 0
    ? COMPLETION_STATUS.PASSED
    : failedCriteria.every((item) => item.retryable)
      ? COMPLETION_STATUS.REPAIRABLE
      : COMPLETION_STATUS.FAILED

  return {
    contractVersion: Number(contract?.version || CONTRACT_VERSION),
    contractTaskId: normalizeString(contract?.taskId),
    status,
    evaluatedAt: normalizeTimestamp(evaluatedAt) || new Date().toISOString(),
    criteria,
    passedCriteriaIds: criteria.filter((item) => item.passed).map((item) => item.id),
    failedCriteria,
    failedCriteriaIds: failedCriteria.map((item) => item.id)
  }
}

export function formatCompletionCorrection(evaluation) {
  const failedCriteria = Array.isArray(evaluation?.failedCriteria) ? evaluation.failedCriteria : []

  if (!failedCriteria.length) {
    return ''
  }

  return [
    'The completion contract is not satisfied yet.',
    ...failedCriteria.map((item, index) => `${index + 1}. ${item.repairInstruction || item.description}`),
    'Address only the failed criteria, preserve work that already passed, and then request completion again.'
  ].join('\n')
}

export function summarizeCompletionForSession(contract, evaluation = null, repairAttempts = 0) {
  const criteria = Array.isArray(contract?.criteria) ? contract.criteria : []
  const resultCriteria = Array.isArray(evaluation?.criteria) ? evaluation.criteria : []

  return {
    contractVersion: Number(contract?.version || CONTRACT_VERSION),
    status: normalizeString(evaluation?.status) || 'running',
    repairAttempts: normalizePositiveInteger(repairAttempts, 0),
    maxRepairAttempts: normalizePositiveInteger(contract?.maxRepairAttempts, DEFAULT_MAX_REPAIR_ATTEMPTS),
    criteria: criteria.map((item) => {
      const result = resultCriteria.find((candidate) => candidate.id === item.id)

      return {
        id: item.id,
        description: item.description,
        passed: result ? Boolean(result.passed) : false
      }
    }),
    evaluatedAt: normalizeTimestamp(evaluation?.evaluatedAt)
  }
}
