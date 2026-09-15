import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentTaskGraph } from '../src/langGraphRuntime.js'

test('task graph routes every continuation through prepare before agent', async () => {
  const phases = []
  let prepareCount = 0
  let runCount = 0

  const graph = createAgentTaskGraph({
    initialRemainingToolIterations: 2,
    prepareAgent: async ({ guardRound, remainingToolIterations }) => {
      phases.push(`prepare:${guardRound}`)
      prepareCount += 1
      return { guardRound, remainingToolIterations }
    },
    runAgent: async (preparedAgent) => {
      phases.push(`agent:${preparedAgent.guardRound}`)
      runCount += 1
      return {
        decision: { action: 'final' },
        toolCalls: 0,
        usage: []
      }
    },
    inspectResult: async ({ guardRound }) => {
      phases.push(`inspect:${guardRound}`)
      return guardRound === 0
        ? { phase: 'continue', terminalReason: 'continue' }
        : { phase: 'stop', terminalReason: 'complete' }
    },
    finalize: async ({ phase }) => {
      phases.push(`finalize:${phase}`)
    }
  })

  await graph.invoke({
    guardRound: 0,
    remainingToolIterations: 2,
    terminalReason: 'continue'
  })

  assert.equal(prepareCount, 2)
  assert.equal(runCount, 2)
  assert.deepEqual(phases, [
    'prepare:0',
    'agent:0',
    'inspect:0',
    'prepare:1',
    'agent:1',
    'inspect:1',
    'finalize:complete'
  ])
})
