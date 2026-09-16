import assert from 'node:assert/strict'
import test from 'node:test'
import { createRunContext, withRun, budgetedModelAttempt, currentRun } from '../src/runContext.js'
import { classifyRunFailure, classifyToolResult, runError } from '../src/runFailure.js'

test('approval resume preserves all ceilings and excludes waiting time', () => {
  let now = 1000
  const events = []
  const options = { sessionId: 's', taskId: 't', now: () => now, onEvent: (event) => events.push(event) }
  const run = createRunContext({ ...options, config: { taskTimeoutMs: 100, maxModelCalls: 1, maxToolCalls: 1, maxCompletionRepairAttempts: 1 } })
  run.consume('modelCalls'); run.consume('toolCalls'); run.consume('repairs')
  now += 30
  const saved = run.finish('waiting_for_user')
  now += 100000
  const resumed = createRunContext({ ...options, restored: saved, config: { maxToolCalls: 99 } })
  resumed.emit('run.resumed')
  assert.equal(resumed.runId, run.runId)
  assert.equal(resumed.remainingTime(), 70)
  assert.equal(resumed.snapshot().used.modelCalls, 1)
  assert.equal(resumed.snapshot().used.repairs, 1)
  assert.throws(() => resumed.consume('toolCalls'), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(resumed.budgetError.details.dimension, 'toolCalls')
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1))
  const fresh = createRunContext({ ...options, taskId: 'new', restored: saved })
  assert.notEqual(fresh.runId, run.runId)
  assert.equal(fresh.snapshot().used.toolCalls, 0)
})

test('concurrent tasks stay isolated and child async operations share their parent budget', async () => {
  const first = createRunContext({ taskId: 'first', config: { maxModelCalls: 1 } })
  const second = createRunContext({ taskId: 'second', config: { maxModelCalls: 2 } })
  await Promise.all([first, second].map((run) => withRun(run, async () => {
    await Promise.resolve()
    assert.equal(currentRun(), run)
    await budgetedModelAttempt({ kind: 'child' }, async () => ({ usage: { totalTokens: 7 } }))
  })))
  await assert.rejects(withRun(first, () => budgetedModelAttempt({}, () => assert.fail('must not dispatch'))), { code: 'BUDGET_EXHAUSTED' })
  await withRun(second, () => budgetedModelAttempt({ kind: 'final' }, async () => ({})))
  assert.equal(second.snapshot().used.totalTokens, 7)
  assert.equal(second.snapshot().used.unknownUsageCalls, 1)
  assert.equal(currentRun(), undefined)
})

test('time, tokens and zero repair budget stop dispatch', () => {
  let now = 0
  const timed = createRunContext({ now: () => now, config: { taskTimeoutMs: 10 } })
  now = 10
  assert.throws(() => timed.consume('modelCalls'), { code: 'BUDGET_EXHAUSTED' })
  const tokens = createRunContext({ config: { maxTotalTokens: 8 } })
  assert.throws(() => tokens.recordUsage({ inputTokens: 5, outputTokens: 3 }), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(tokens.snapshot().used.totalTokens, 8)
  assert.throws(() => createRunContext({ config: { maxCompletionRepairAttempts: 0 } }).consume('repairs'), { code: 'BUDGET_EXHAUSTED' })
})

test('failures distinguish policy, validation, environment, cancellation and returned errors', () => {
  for (const [code, category] of [['POLICY_DENIED', 'policy'], ['COMPLETION_REJECTED', 'validation'], ['ENOENT', 'environment'], ['TASK_CANCELLED', 'cancelled'], ['RUN_INTERRUPTED', 'interrupted']]) {
    assert.equal(classifyRunFailure(runError(code, 'failure')).category, category)
  }
  assert.equal(classifyToolResult({ result: { isError: true } }).category, 'tool')
  assert.equal(classifyToolResult({ result: { exitCode: null } }).category, 'tool')
  assert.equal(classifyToolResult({ result: { timedOut: true } }).category, 'timeout')
  assert.equal(classifyToolResult({ result: { blocked: true } }).category, 'policy')
  assert.equal(classifyToolResult({ result: { exitCode: 0 } }), null)
})
