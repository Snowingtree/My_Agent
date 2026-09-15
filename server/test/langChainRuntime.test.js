import assert from 'node:assert/strict'
import test from 'node:test'
import { runLangChainAgent } from '../src/langChainRuntime.js'

function createCompletionSequence(decisions) {
  const queue = [...decisions]

  return async () => {
    const decision = queue.shift()

    if (!decision) {
      throw new Error('Unexpected model call.')
    }

    return {
      json: decision,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      }
    }
  }
}

test('LangChain agent executes a bound tool and continues to a final decision', async () => {
  const calls = []
  const result = await runLangChainAgent({
    aiConfig: { aiId: 'test' },
    model: 'test-model',
    messages: [{ role: 'user', content: 'Read the project file.' }],
    toolCatalog: [{
      name: 'read_file',
      description: 'Read a workspace file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path'],
        additionalProperties: false
      }
    }],
    executeTool: async (request, metadata) => {
      calls.push({ request, metadata })
      return {
        ok: true,
        toolExecution: {
          status: 'success',
          summary: 'Read package.json.',
          result: { content: '{"name":"demo"}' }
        }
      }
    },
    maxToolIterations: 3,
    structuredCompletion: createCompletionSequence([
      {
        action: 'tool',
        summary: 'Reading project metadata.',
        thought_summary: 'I need workspace evidence.',
        tool: {
          name: 'read_file',
          args: { path: 'package.json' }
        }
      },
      {
        action: 'final',
        summary: 'Project metadata inspected.',
        reply: ''
      }
    ])
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].request, {
    name: 'read_file',
    args: { path: 'package.json' }
  })
  assert.equal(calls[0].metadata.summary, 'Reading project metadata.')
  assert.equal(result.toolCalls, 1)
  assert.equal(result.modelCalls, 2)
  assert.equal(result.decision.action, 'final')
  assert.equal(result.stopped, null)
  assert.ok(result.messages.some((message) => message._getType() === 'tool'))
})

test('LangChain agent exposes an ask_user decision without calling a tool', async () => {
  const result = await runLangChainAgent({
    aiConfig: { aiId: 'test' },
    model: 'test-model',
    messages: [{ role: 'user', content: 'Update the unspecified file.' }],
    toolCatalog: [],
    executeTool: async () => {
      throw new Error('No tool should run.')
    },
    structuredCompletion: createCompletionSequence([{
      action: 'ask_user',
      summary: 'A target path is required.',
      reply: '你希望修改哪个文件？'
    }])
  })

  assert.equal(result.toolCalls, 0)
  assert.equal(result.modelCalls, 1)
  assert.equal(result.decision.action, 'ask_user')
  assert.equal(result.decision.reply, '你希望修改哪个文件？')
})

test('LangChain agent stops when the existing tool harness waits for approval', async () => {
  const result = await runLangChainAgent({
    aiConfig: { aiId: 'test' },
    model: 'test-model',
    messages: [{ role: 'user', content: 'Run a protected command.' }],
    toolCatalog: [{
      name: 'run_command',
      description: 'Run an approved command.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' }
        },
        required: ['command']
      }
    }],
    executeTool: async () => ({
      ok: false,
      waitingForApproval: true,
      approval: { approvalId: 'approval-1' }
    }),
    structuredCompletion: createCompletionSequence([{
      action: 'tool',
      summary: 'Requesting command execution.',
      tool: {
        name: 'run_command',
        args: { command: 'npm' }
      }
    }])
  })

  assert.equal(result.modelCalls, 1)
  assert.equal(result.toolCalls, 1)
  assert.equal(result.stopped.waitingForApproval, true)
})
