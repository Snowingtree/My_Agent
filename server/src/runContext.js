import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { classifyRunFailure, runError } from './runFailure.js'

const storage = new AsyncLocalStorage()
const count = (value, fallback = 0) => Number.isFinite(Number(value)) && Number(value) >= 0
  ? Math.floor(Number(value)) : fallback
export const currentRun = () => storage.getStore()
export const withRun = (run, callback) => storage.run(run, callback)

export function createRunContext({ sessionId, taskId, config = {}, restored, onEvent = () => {}, now = Date.now } = {}) {
  const previous = restored?.taskId === taskId ? restored : null
  const runId = previous?.runId || `run_${randomUUID()}`
  const limits = previous?.limits || {
    activeMs: count(config.taskTimeoutMs, 900000),
    modelCalls: count(config.maxModelCalls, 40),
    toolCalls: count(config.maxToolCalls, 60),
    totalTokens: count(config.maxTotalTokens, 0),
    repairs: count(config.maxCompletionRepairAttempts, 2)
  }
  const used = { modelCalls: 0, toolCalls: 0, totalTokens: 0, repairs: 0, unknownUsageCalls: 0,
    ...previous?.used }
  const baseActiveMs = count(previous?.used?.activeMs)
  const startedMs = now()
  let frozenMs = null
  let sequence = count(previous?.sequence)
  let budgetError = null
  let lastFailure = null
  const activeMs = () => baseActiveMs + Math.max(0, (frozenMs ?? now()) - startedMs)
  const snapshot = () => ({ version: 1, sessionId, taskId, runId, sequence,
    limits: { ...limits }, used: { ...used, activeMs: activeMs() } })
  const emit = (type, data = {}) => {
    const event = { schemaVersion: 1, eventId: `${runId}:${++sequence}`, runId, sessionId, taskId,
      sequence, at: new Date(now()).toISOString(), type, ...data }
    onEvent(event)
    return event
  }
  const exhaust = (dimension) => {
    if (!budgetError) {
      budgetError = runError('BUDGET_EXHAUSTED', `任务执行预算已耗尽：${dimension}。`, { dimension })
      lastFailure = classifyRunFailure(budgetError)
      emit('budget.exhausted', { failure: lastFailure, budget: snapshot() })
    }
    return budgetError
  }
  const assertWithinBudget = () => {
    if (budgetError) throw budgetError
    if (limits.activeMs > 0 && activeMs() >= limits.activeMs) throw exhaust('activeMs')
    if (limits.totalTokens > 0 && used.totalTokens >= limits.totalTokens) throw exhaust('totalTokens')
  }
  const consume = (dimension, metadata = {}) => {
    assertWithinBudget()
    // Zero disables the optional call/token ceilings; zero repairs means no repair.
    if ((limits[dimension] > 0 || dimension === 'repairs') && used[dimension] >= limits[dimension]) {
      throw exhaust(dimension)
    }
    used[dimension] += 1
    emit('budget.consumed', { dimension, ...metadata, budget: snapshot() })
  }
  const recordUsage = (usage) => {
    const total = usage?.totalTokens ?? (
      Number.isFinite(usage?.inputTokens) && Number.isFinite(usage?.outputTokens)
        ? usage.inputTokens + usage.outputTokens : null
    )
    if (!Number.isFinite(total) || total < 0) used.unknownUsageCalls += 1
    else used.totalTokens += total
    emit('model.usage', { usage: { totalTokens: Number.isFinite(total) ? total : null }, budget: snapshot() })
    assertWithinBudget()
  }
  const fail = (error, options) => {
    lastFailure = classifyRunFailure(error, options)
    emit('failure.observed', { failure: lastFailure })
    return lastFailure
  }
  return {
    runId, taskId, emit, snapshot, consume, recordUsage, assertWithinBudget, exhaust, fail,
    get failure() { return lastFailure },
    get budgetError() { return budgetError },
    remainingTime: () => limits.activeMs > 0 ? Math.max(0, limits.activeMs - activeMs()) : 0,
    hasDeadline: () => limits.activeMs > 0,
    finish(status, failure = null) {
      frozenMs = now()
      emit('run.finished', { status, failure, budget: snapshot() })
      return snapshot()
    }
  }
}

// Called once per transport attempt, including timeout retries and child/final/summary calls.
export async function budgetedModelAttempt(metadata, callback, { signal } = {}) {
  const run = currentRun()
  if (!run) return callback()
  run.consume('modelCalls', metadata)
  const callId = `${run.runId}:model:${run.snapshot().used.modelCalls}`
  run.emit('model.started', { callId, ...metadata })
  let usageRecorded = false
  try {
    const result = await callback()
    if (result?.response?.ok === false) {
      run.emit('model.failed', { callId, ...metadata,
        failure: classifyRunFailure(runError(`HTTP_${result.response.status}`, `Model request failed with ${result.response.status}.`), { source: 'model' }) })
    } else run.emit('model.completed', { callId, ...metadata })
    usageRecorded = true
    run.recordUsage(result?.usage)
    return result
  } catch (error) {
    const observedError = run.budgetError || (error?.name === 'AbortError'
      ? runError(signal?.aborted ? 'TASK_CANCELLED' : 'MODEL_TIMEOUT', signal?.aborted ? 'Task was cancelled.' : 'Model request timed out.')
      : error)
    const failure = classifyRunFailure(observedError, { source: 'model' })
    run.emit('model.failed', { callId, failure })
    if (!usageRecorded && !run.budgetError) run.recordUsage(null)
    throw run.budgetError || error
  }
}
