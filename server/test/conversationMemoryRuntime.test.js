import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationMemoryRuntime } from '../src/conversationMemoryRuntime.js'

test('LangGraph SQLite checkpoint persists and compacts conversation state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-agent-checkpoint-'))
  const databasePath = join(directory, 'checkpoints.sqlite')
  const runtime = createConversationMemoryRuntime({ databasePath, thresholdTurns: 2, keepTurns: 1 })

  try {
    const compacted = await runtime.initializeThread({
      threadId: 'session-1',
      messages: [
        { messageId: 'user-1', role: 'user', content: 'Old question' },
        { messageId: 'assistant-1', role: 'assistant', content: 'Old answer' },
        { messageId: 'user-2', role: 'user', content: 'Current question' }
      ],
      summarize: async () => 'Compressed history.'
    })

    assert.equal(compacted.summary, 'Compressed history.')
    assert.deepEqual(compacted.messages.map((message) => message.id), ['user-2'])
    await runtime.appendMessage('session-1', {
      messageId: 'assistant-2',
      role: 'assistant',
      content: 'Current answer'
    })
  } finally {
    runtime.close()
  }

  const restoredRuntime = createConversationMemoryRuntime({ databasePath })

  try {
    const restored = await restoredRuntime.getState('session-1')
    assert.equal(restored.summary, 'Compressed history.')
    assert.deepEqual(restored.messages.map((message) => message.id), ['user-2', 'assistant-2'])
  } finally {
    restoredRuntime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('LangGraph checkpoint is authoritative after one-time thread initialization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-agent-checkpoint-'))
  const databasePath = join(directory, 'checkpoints.sqlite')
  const runtime = createConversationMemoryRuntime({ databasePath })

  try {
    await runtime.initializeThread({
      threadId: 'session-2',
      messages: [
        { messageId: 'user-1', role: 'user', content: 'First question' },
        { messageId: 'assistant-1', role: 'assistant', content: 'First answer' }
      ]
    })

    const nextState = await runtime.appendMessage('session-2', {
      messageId: 'user-2',
      role: 'user',
      content: 'Second question'
    })

    assert.deepEqual(nextState.messages.map((message) => message.id), ['user-1', 'assistant-1', 'user-2'])

    const unchangedState = await runtime.initializeThread({
      threadId: 'session-2',
      messages: [
        { messageId: 'stale-user', role: 'user', content: 'This must not replace the checkpoint' }
      ]
    })

    assert.deepEqual(unchangedState.messages.map((message) => message.id), ['user-1', 'assistant-1', 'user-2'])
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})
