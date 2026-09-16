import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPLETION_STATUS,
  createCompletionContract,
  createCompletionEvidence,
  evaluateCompletion,
  formatCompletionCorrection,
  recordCompletionEvidence,
  summarizeCompletionForSession
} from '../src/completionHarness.js'

const T0 = '2026-09-16T01:00:00.000Z'
const T1 = '2026-09-16T01:01:00.000Z'
const T2 = '2026-09-16T01:02:00.000Z'
const T3 = '2026-09-16T01:03:00.000Z'

test('completion contract requires objective evidence for a file change', () => {
  const contract = createCompletionContract({
    taskId: 'task-1',
    goal: 'Update the page and split its CSS.',
    createdAt: T0,
    requiresWorkspaceInspection: true,
    requiresWorkspaceChange: true,
    verificationAvailable: true,
    requiredCompanionExtensions: ['.css'],
    requiredSkillIds: ['frontend_quality'],
    requiresUserProfileMemory: true,
    maxRepairAttempts: 2
  })
  const initial = evaluateCompletion(contract, createCompletionEvidence({ startedAt: T0 }), {
    evaluatedAt: T1
  })

  assert.equal(initial.status, COMPLETION_STATUS.REPAIRABLE)
  assert.deepEqual(initial.failedCriteriaIds, [
    'required_skills_active',
    'user_profile_updated',
    'workspace_inspected',
    'workspace_changed',
    'companion_files_changed',
    'workspace_change_verified'
  ])
  assert.match(formatCompletionCorrection(initial), /completion contract is not satisfied/i)
})

test('completion evidence passes all configured file-change criteria', () => {
  const contract = createCompletionContract({
    taskId: 'task-2',
    createdAt: T0,
    requiresWorkspaceInspection: true,
    requiresWorkspaceChange: true,
    verificationAvailable: true,
    requiredCompanionExtensions: ['.css'],
    requiredSkillIds: ['frontend_quality'],
    requiresUserProfileMemory: true
  })
  let evidence = createCompletionEvidence({ startedAt: T0 })

  evidence = recordCompletionEvidence(evidence, {
    type: 'skill.activated',
    skillId: 'frontend_quality',
    at: T1
  })
  evidence = recordCompletionEvidence(evidence, { type: 'user_profile.updated', at: T1 })
  evidence = recordCompletionEvidence(evidence, { type: 'workspace.inspected', at: T1 })
  evidence = recordCompletionEvidence(evidence, {
    type: 'workspace.modified',
    path: 'src/page.css',
    at: T2
  })
  evidence = recordCompletionEvidence(evidence, { type: 'verification.passed', at: T3 })

  const evaluation = evaluateCompletion(contract, evidence, { evaluatedAt: T3 })

  assert.equal(evaluation.status, COMPLETION_STATUS.PASSED)
  assert.deepEqual(evaluation.failedCriteriaIds, [])
})

test('verification must be newer than the latest workspace mutation', () => {
  const contract = createCompletionContract({
    taskId: 'task-3',
    createdAt: T0,
    requiresWorkspaceChange: true,
    verificationAvailable: true
  })
  let evidence = createCompletionEvidence({ startedAt: T0 })

  evidence = recordCompletionEvidence(evidence, {
    type: 'workspace.modified',
    path: 'src/first.js',
    at: T1
  })
  evidence = recordCompletionEvidence(evidence, { type: 'verification.passed', at: T2 })
  evidence = recordCompletionEvidence(evidence, {
    type: 'workspace.modified',
    path: 'src/second.js',
    at: T3
  })

  const evaluation = evaluateCompletion(contract, evidence, { evaluatedAt: T3 })

  assert.equal(evaluation.status, COMPLETION_STATUS.REPAIRABLE)
  assert.deepEqual(evaluation.failedCriteriaIds, ['workspace_change_verified'])
})

test('a workspace mutation makes a read-only contract non-repairable', () => {
  const contract = createCompletionContract({
    taskId: 'task-4',
    createdAt: T0,
    requiresWorkspaceInspection: true,
    enforceReadOnlyWorkspace: true
  })
  let evidence = createCompletionEvidence({ startedAt: T0 })

  evidence = recordCompletionEvidence(evidence, { type: 'workspace.inspected', at: T1 })
  evidence = recordCompletionEvidence(evidence, {
    type: 'workspace.modified',
    path: 'README.md',
    at: T2
  })

  const evaluation = evaluateCompletion(contract, evidence, { evaluatedAt: T3 })

  assert.equal(evaluation.status, COMPLETION_STATUS.FAILED)
  assert.deepEqual(evaluation.failedCriteriaIds, ['workspace_unchanged'])
})

test('session summary exposes criteria without persisting repair instructions', () => {
  const contract = createCompletionContract({
    taskId: 'task-5',
    createdAt: T0,
    requiresWorkspaceChange: true,
    maxRepairAttempts: 3
  })
  const evaluation = evaluateCompletion(contract, createCompletionEvidence({ startedAt: T0 }), {
    evaluatedAt: T1
  })
  const summary = summarizeCompletionForSession(contract, evaluation, 1)

  assert.equal(summary.status, COMPLETION_STATUS.REPAIRABLE)
  assert.equal(summary.repairAttempts, 1)
  assert.equal(summary.maxRepairAttempts, 3)
  assert.deepEqual(summary.criteria, [{
    id: 'workspace_changed',
    description: 'The task must produce a real workspace change.',
    passed: false
  }])
  assert.equal(Object.hasOwn(summary.criteria[0], 'repairInstruction'), false)
})

test('latest command failure invalidates verification and mutation clears all command results', () => {
  let evidence = createCompletionEvidence({ startedAt: T0 })
  evidence = recordCompletionEvidence(evidence, { type: 'verification.command', commandId: '0', status: 'success', at: T1 })
  evidence = recordCompletionEvidence(evidence, { type: 'verification.command', commandId: '1', status: 'success', at: T1 })
  evidence = recordCompletionEvidence(evidence, { type: 'verification.passed', at: T1 })
  evidence = recordCompletionEvidence(evidence, { type: 'verification.command', commandId: '1', status: 'failed', at: T2 })
  assert.equal(evidence.verification.passed, false)
  assert.equal(evidence.verification.commands['0'], true)
  assert.equal(evidence.verification.commands['1'], false)
  evidence = recordCompletionEvidence(evidence, { type: 'workspace.modified', path: 'page.js', at: T3 })
  assert.deepEqual(evidence.verification.commands, {})
})
