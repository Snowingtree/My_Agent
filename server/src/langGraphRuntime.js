import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

const AgentTaskState = Annotation.Root({
  phase: Annotation({
    reducer: (_, next) => next,
    default: () => 'agent'
  }),
  guardRound: Annotation({
    reducer: (_, next) => next,
    default: () => 0
  }),
  remainingToolIterations: Annotation({
    reducer: (_, next) => next,
    default: () => 0
  }),
  preparedAgent: Annotation({
    reducer: (_, next) => next,
    default: () => null
  }),
  lastDecision: Annotation({
    reducer: (_, next) => next,
    default: () => null
  }),
  lastUsage: Annotation({
    reducer: (_, next) => next,
    default: () => null
  }),
  agentResult: Annotation({
    reducer: (_, next) => next,
    default: () => null
  }),
  verificationResult: Annotation({
    reducer: (_, next) => next,
    default: () => null
  }),
  correctionMessage: Annotation({
    reducer: (_, next) => next,
    default: () => ''
  }),
  terminalReason: Annotation({
    reducer: (_, next) => next,
    default: () => ''
  })
})

function routeAfterAgent(state) {
  if (state.terminalReason === 'continue') {
    return 'prepare'
  }

  return 'finalize'
}

/**
 * Builds the task-level graph around one or more LangChain agents.
 * Business integrations stay in callbacks so the graph remains reusable.
 */
export function createAgentTaskGraph({
  initialRemainingToolIterations = 1,
  maxGuardRounds = 3,
  prepareAgent,
  runAgent,
  inspectResult,
  finalize
} = {}) {
  for (const [name, callback] of Object.entries({ prepareAgent, runAgent, inspectResult, finalize })) {
    if (typeof callback !== 'function') {
      throw new TypeError(`createAgentTaskGraph requires a ${name} callback.`)
    }
  }

  const graph = new StateGraph(AgentTaskState)
    .addNode('prepare', async (state) => {
      const preparedAgent = await prepareAgent({
        guardRound: state.guardRound,
        remainingToolIterations: state.remainingToolIterations
      })

      return {
        preparedAgent,
        phase: 'agent'
      }
    })
    .addNode('agent', async (state) => {
      const agentResult = await runAgent(state.preparedAgent)

      return {
        agentResult,
        lastDecision: agentResult?.decision || null,
        lastUsage: Array.isArray(agentResult?.usage) ? agentResult.usage.at(-1) || null : null,
        phase: 'inspect'
      }
    })
    .addNode('inspect', async (state) => {
      const inspection = await inspectResult({
        agentResult: state.agentResult,
        lastDecision: state.lastDecision,
        lastUsage: state.lastUsage,
        guardRound: state.guardRound,
        remainingToolIterations: state.remainingToolIterations,
        maxGuardRounds
      })

      const toolCalls = Number(inspection?.toolCalls || state.agentResult?.toolCalls || 0)
      const nextRemainingToolIterations = Math.max(
        0,
        state.remainingToolIterations - toolCalls
      )
      const shouldContinue = inspection?.phase === 'continue'

      return {
        phase: shouldContinue ? 'agent' : 'finalize',
        guardRound: state.guardRound + (shouldContinue ? 1 : 0),
        remainingToolIterations: nextRemainingToolIterations,
        verificationResult: inspection?.verificationResult || null,
        correctionMessage: inspection?.correctionMessage || '',
        terminalReason: inspection?.terminalReason || (shouldContinue ? 'continue' : 'complete')
      }
    })
    .addNode('finalize', async (state) => {
      await finalize({
        phase: state.terminalReason,
        agentResult: state.agentResult,
        lastDecision: state.lastDecision,
        lastUsage: state.lastUsage,
        verificationResult: state.verificationResult,
        correctionMessage: state.correctionMessage,
        guardRound: state.guardRound,
        remainingToolIterations: state.remainingToolIterations
      })

      return { phase: 'done' }
    })
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'agent')
    .addEdge('agent', 'inspect')
    .addConditionalEdges('inspect', routeAfterAgent, {
      prepare: 'prepare',
      finalize: 'finalize'
    })
    .addEdge('finalize', END)

  return graph.compile()
}
