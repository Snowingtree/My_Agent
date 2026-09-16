import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentRunner } from '../src/agentRunner.js'
import { createRunContext } from '../src/runContext.js'
import { createCompletionContract, createCompletionEvidence } from '../src/completionHarness.js'
import { replayRun } from '../src/runReplay.js'

function fixture(t, { maxModelCalls = 20, taskTimeoutMs = 10000, goal = '你好', decisions = [], workspaceConfig = {}, executeToolCall, approval, onRequest } = {}) {
  const records = []
  const taskStates = []
  const session = { sessionId: 's', title: 'Test', task: { taskId: 't', status: 'queued' },
    messages: [{ role: 'user', content: goal }], pendingToolApproval: approval }
  let requests = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_, options) => {
    requests += 1
    if (onRequest) return onRequest(options)
    const body = JSON.parse(options.body)
    const content = body.response_format || body.messages.some((message) => String(message.content).includes('"action"'))
      ? JSON.stringify(decisions.shift() || { action: 'final', reply: '你好', summary: '完成' })
      : '你好，这是一条最终回复。'
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 3 } }),
      { headers: { 'content-type': 'application/json' } })
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const repository = {
    getSession: async () => structuredClone(session),
    updateSession: async (_, updater) => {
      Object.assign(session, await updater(structuredClone(session)))
      taskStates.push(session.task.status)
      return structuredClone(session)
    },
    appendAssistantMessage: async (_, message) => { session.messages.push({ role: 'assistant', ...message }); return message },
    appendToolMessage: async (_, message) => { session.messages.push({ role: 'tool', ...message }); return message }
  }
  const runner = createAgentRunner({ sessionRepository: repository,
    aiRuntimeConfig: { requestTimeoutMs: 1000, recentMessages: 10 },
    getAiConfigById: async () => ({ aiId: 'test', apiKey: 'test', baseURL: 'https://api.openai.com/v1' }),
    resolveModel: () => 'gpt-test',
    runtimeConfig: { stepDelayMs: 0, maxToolIterations: 10, taskTimeoutMs, maxModelCalls, maxToolCalls: 20, maxCompletionRepairAttempts: 1 },
    workspaceConfig,
    toolRunner: { getPromptText: () => '', getToolCatalog: () => ['read_file', 'write_file', 'run_command'].map((name) => ({ name, description: name })),
      executeToolCall: executeToolCall || (async () => { throw new Error('unexpected tool execution') }) },
    auditLogger: { logEvent: (event) => records.push(event) }
  })
  return { runner, session, records, taskStates, requests: () => requests }
}

test('final answer request shares the budget and task cannot be completed prematurely', async (t) => {
  const { runner, session, taskStates, records, requests } = fixture(t, { maxModelCalls: 1 })
  await runner.startTask({ sessionId: 's' })
  assert.equal(requests(), 1)
  assert.equal(session.task.status, 'failed')
  assert.equal(session.task.failure.category, 'budget')
  assert.equal(taskStates.includes('completed'), false)
  assert.equal(session.task.run.used.modelCalls, 1)
  assert.equal(records.filter((event) => event.type === 'run.finished').length, 1)
  assert.equal(replayRun(records, session.task.run.runId).status, 'failed')
})

test('successful final reply is saved before completion with replayable budget evidence', async (t) => {
  const { runner, session, records, requests } = fixture(t)
  await runner.startTask({ sessionId: 's' })
  assert.equal(session.task.status, 'completed', session.task.summary)
  assert.equal(requests(), 2)
  assert.equal(session.task.run.used.totalTokens, 6)
  assert.equal(session.messages.at(-1).role, 'assistant')
  const replay = replayRun(records, session.task.run.runId)
  assert.equal(replay.incomplete, false)
  assert.equal(replay.replayedEvaluation.status, 'passed')
})

test('one successful configured check cannot hide a failed second check', async (t) => {
  const calls = []
  const { runner, session } = fixture(t, {
    goal: '修改 page.js 文件',
    decisions: [
      { action: 'tool', tool: { name: 'read_file', args: { path: 'page.js' } } },
      { action: 'tool', tool: { name: 'write_file', args: { path: 'page.js', content: 'new' } } },
      { action: 'tool', tool: { name: 'run_command', args: { command: 'npm', args: ['run', 'build'], cwd: '.' } } }
    ],
    workspaceConfig: { autoVerifyAfterWrite: true, autoVerifyCommands: [
      { command: 'npm', args: ['run', 'build'] }, { command: 'npm', args: ['test'] }
    ] },
    executeToolCall: async (request) => {
      calls.push(request)
      const result = request.name === 'run_command'
        ? { ...request.args, exitCode: request.args.args[0] === 'test' ? 1 : 0 }
        : { path: 'page.js', changed: request.name === 'write_file' }
      return { tool: request.name, result, summary: 'tool result', message: 'tool result' }
    }
  })
  await runner.startTask({ sessionId: 's' })
  assert.ok(calls.some((call) => call.args.args?.[0] === 'test'))
  assert.equal(session.task.status, 'failed', session.task.summary)
  assert.equal(session.task.failure.category, 'validation')
  assert.equal(session.task.completion.criteria.find((item) => item.id === 'workspace_change_verified').passed, false)
  assert.equal(session.task.run.used.repairs, 1)
})

test('approved continuation cannot reset the task tool budget', async (t) => {
  const original = createRunContext({ sessionId: 's', taskId: 't', config: { maxToolCalls: 1 } })
  original.consume('toolCalls')
  const saved = original.finish('waiting_for_user')
  let dispatches = 0
  const { runner, session } = fixture(t, { approval: {
    status: 'approved', approvalId: 'approval', tool: 'run_command', args: { command: 'npm', args: ['test'] }, goal: '你好',
    state: { run: saved, verificationCommands: [], completionContract: createCompletionContract({ taskId: 't' }), completionEvidence: createCompletionEvidence() }
  }, executeToolCall: async () => { dispatches += 1 } })
  await runner.startTask({ sessionId: 's', approvedToolApprovalId: 'approval' })
  assert.equal(dispatches, 0)
  assert.equal(session.task.failure.category, 'budget')
  assert.equal(session.task.run.runId, original.runId)
  assert.equal(session.task.run.used.toolCalls, 1)
})

test('task deadline aborts an in-flight model and records budget failure', async (t) => {
  const { runner, session } = fixture(t, { taskTimeoutMs: 100,
    onRequest: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    }) })
  await runner.startTask({ sessionId: 's' })
  assert.equal(session.task.status, 'failed')
  assert.equal(session.task.failure.category, 'budget')
  assert.equal(session.task.failure.dimension, 'activeMs')
  assert.ok(session.task.steps.every((step) => !['running', 'in_progress'].includes(step.status)))
})

test('user cancellation stays distinct from deadline exhaustion', async (t) => {
  let started
  const ready = new Promise((resolve) => { started = resolve })
  const { runner, session } = fixture(t, {
    onRequest: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      started()
    }) })
  const running = runner.startTask({ sessionId: 's' })
  await ready
  await runner.cancelTask('s')
  await running
  assert.equal(session.task.status, 'cancelled')
  assert.equal(session.task.failure.category, 'cancelled')
})
