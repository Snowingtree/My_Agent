import assert from 'node:assert/strict'
import test from 'node:test'
import { createRunContext } from '../src/runContext.js'
import { createCompletionContract, createCompletionEvidence, recordCompletionEvidence, evaluateCompletion } from '../src/completionHarness.js'
import { replayRun, listRunSummaries } from '../src/runReplay.js'

test('read-only replay reconstructs criteria, evidence and budget at any event', () => {
  const records = []
  const at = '2026-09-16T00:00:00.000Z'
  const run = createRunContext({ taskId: 't', sessionId: 's', now: () => Date.parse(at),
    onEvent: (event) => records.push({ ...event, event: 'harness_event' }) })
  const contract = createCompletionContract({ taskId: 't', createdAt: at, requiresWorkspaceChange: true })
  run.emit('run.started', { budget: run.snapshot() })
  run.emit('contract.created', { contract })
  const evidenceEvent = { type: 'workspace.modified', path: 'page.css', at }
  run.emit('evidence.recorded', { evidence: evidenceEvent })
  run.consume('toolCalls')
  const live = evaluateCompletion(contract, recordCompletionEvidence(createCompletionEvidence({ startedAt: at }), evidenceEvent), { evaluatedAt: at })
  run.emit('completion.evaluated', { evaluation: live })
  run.finish('completed')
  assert.equal(replayRun(records, run.runId, 2).replayedEvaluation.status, 'repairable')
  const replay = replayRun(records, run.runId)
  assert.deepEqual(replay.replayedEvaluation, live)
  assert.equal(replay.budget.used.toolCalls, 1)
  assert.deepEqual(replay.evidence.workspace.changedFiles, ['page.css'])
  assert.equal(listRunSummaries(records)[0].status, 'completed')
  assert.equal(replayRun(records, 'missing'), null)
  for (const broken of [records.slice(1), records.filter((_, index) => index !== 2), records.map((r, index) => index === 2 ? { ...r, dataTruncated: true } : r)]) {
    assert.equal(replayRun(broken, run.runId).incomplete, true)
    assert.equal(replayRun(broken, run.runId).replayedEvaluation, null)
  }
})
