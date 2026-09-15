import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DELEGATE_TASK_TOOL_NAME,
  READ_ONLY_SUB_AGENT_TOOL_NAMES,
  createSubAgentRuntime
} from '../src/subAgentRuntime.js'

test('sub-agent delegation has an isolated brief and enforced read-only tools', async () => {
  const toolCalls = []
  const auditEvents = []
  let receivedMessages = []
  const runtime = createSubAgentRuntime({
    config: {
      maxDelegationsPerTask: 2,
      maxToolIterations: 2,
      timeoutMs: 10000
    },
    toolRunner: {
      getToolCatalog(options) {
        assert.deepEqual(options.allowedToolNames, READ_ONLY_SUB_AGENT_TOOL_NAMES)
        return READ_ONLY_SUB_AGENT_TOOL_NAMES.map((name) => ({
          name,
          description: name,
          inputSchema: { type: 'object', properties: {} }
        }))
      },
      async executeToolCall(request, options) {
        toolCalls.push({ request, options })
        return {
          tool: request.name,
          args: request.args,
          result: { path: 'src/example.js', content: 'const value = 1' },
          summary: 'Read src/example.js.',
          message: 'Tool: read_file\nPath: src/example.js'
        }
      }
    },
    runAgent: async (options) => {
      receivedMessages = options.messages
      await options.onDecision({
        modelCall: 1,
        action: 'tool',
        summary: 'Inspect the requested file.',
        thoughtSummary: 'Read the file first.',
        usage: { totalTokens: 12 }
      })
      await options.executeTool({
        name: 'read_file',
        args: { path: 'src/example.js' }
      })
      return {
        modelCalls: 2,
        toolCalls: 1,
        decision: { summary: 'Review complete.' }
      }
    },
    textCompletion: async () => ({
      text: '发现：src/example.js 缺少输入校验。'
    })
  })

  assert.equal(runtime.getToolDefinition().name, DELEGATE_TASK_TOOL_NAME)

  const result = await runtime.delegate({
    sessionId: 'session-parent',
    parentTaskId: 'task-parent',
    parentExecutionId: 'tool-parent',
    agent: 'code_reviewer',
    task: 'Review src/example.js only.',
    aiConfig: { apiKey: 'test' },
    model: 'test-model',
    requestTimeoutMs: 1000,
    idleTimeoutMs: 1000,
    audit: (event, payload) => auditEvents.push({ event, payload })
  })

  assert.equal(result.agent, 'code_reviewer')
  assert.equal(result.parentTaskId, 'task-parent')
  assert.match(result.report, /输入校验/)
  assert.equal(toolCalls.length, 1)
  assert.equal(toolCalls[0].options.sessionId, 'session-parent')
  assert.deepEqual(toolCalls[0].options.allowedToolNames, READ_ONLY_SUB_AGENT_TOOL_NAMES)
  assert.equal(receivedMessages.some((message) => String(message.content).includes('parent conversation')), true)
  assert.equal(auditEvents.some((item) => item.event === 'system_action' && item.payload.action === 'subagent_started'), true)
  assert.equal(auditEvents.some((item) => item.event === 'system_action' && item.payload.action === 'subagent_completed'), true)
  assert.equal(auditEvents.every((item) => item.payload.parentTaskId === 'task-parent'), true)
})
