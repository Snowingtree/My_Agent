import Database from 'better-sqlite3'
import { AIMessage, HumanMessage, RemoveMessage, SystemMessage } from '@langchain/core/messages'
import { Annotation, END, REMOVE_ALL_MESSAGES, START, MessagesAnnotation, StateGraph } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { normalizeTrimmedString, nowIso } from './utils.js'

const ConversationMemoryState = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  summary: Annotation({
    reducer: (_, next) => normalizeTrimmedString(next),
    default: () => ''
  }),
  updatedAt: Annotation({
    reducer: (_, next) => normalizeTrimmedString(next) || nowIso(),
    default: () => null
  }),
  compressedTurnCount: Annotation({
    reducer: (_, next) => Math.max(0, Number(next) || 0),
    default: () => 0
  }),
  keptTurnCount: Annotation({
    reducer: (_, next) => Math.max(0, Number(next) || 0),
    default: () => 0
  })
})

function messageType(message) {
  if (typeof message?._getType === 'function') {
    return message._getType()
  }

  return normalizeTrimmedString(message?.role).toLowerCase()
}

function groupMessagesIntoTurns(messages = []) {
  const turns = []
  let currentTurn = null

  for (const message of Array.isArray(messages) ? messages : []) {
    const type = messageType(message)

    if (type === 'human' || type === 'user') {
      currentTurn = []
      turns.push(currentTurn)
    }

    if (!currentTurn) {
      currentTurn = []
      turns.push(currentTurn)
    }

    currentTurn.push(message)
  }

  return turns.filter((turn) => turn.length > 0)
}

function flattenTurns(turns = []) {
  return turns.flatMap((turn) => turn)
}

function normalizeMessageId(message) {
  return normalizeTrimmedString(message?.messageId || message?.id)
}

function toLangChainMessage(message) {
  const content = String(message?.content ?? '')
  const id = normalizeMessageId(message)
  const fields = id ? { content, id } : { content }
  const role = normalizeTrimmedString(message?.role).toLowerCase()

  if (role === 'user' || role === 'human') {
    return new HumanMessage(fields)
  }

  if (role === 'system') {
    return new SystemMessage(fields)
  }

  return new AIMessage(fields)
}

function toStoredMessage(message) {
  const type = messageType(message)
  const role = type === 'human' || type === 'user' ? 'user' : type === 'system' ? 'system' : 'assistant'

  return {
    messageId: normalizeTrimmedString(message?.id),
    role,
    content: String(message?.content ?? '')
  }
}

function createThreadConfig(threadId) {
  return {
    configurable: {
      thread_id: normalizeTrimmedString(threadId)
    }
  }
}

export function createConversationMemoryRuntime({
  databasePath,
  thresholdTurns = 40,
  keepTurns = 10,
  maxSummaryChars = 6000
} = {}) {
  const normalizedDatabasePath = normalizeTrimmedString(databasePath)

  if (!normalizedDatabasePath) {
    throw new TypeError('createConversationMemoryRuntime requires a databasePath.')
  }

  const db = new Database(normalizedDatabasePath)
  const checkpointer = new SqliteSaver(db)

  const graph = new StateGraph(ConversationMemoryState)
    .addNode('compact', async (state, config) => {
      const stateMessages = Array.isArray(state.messages) ? state.messages : []
      const turns = groupMessagesIntoTurns(stateMessages)
      const normalizedThreshold = Math.max(1, Number(thresholdTurns) || 40)
      const normalizedKeepTurns = Math.max(1, Number(keepTurns) || 10)

      if (turns.length < normalizedThreshold || turns.length <= normalizedKeepTurns) {
        return {
          updatedAt: nowIso()
        }
      }

      const cutoff = Math.max(0, turns.length - normalizedKeepTurns)
      const turnsToCompress = turns.slice(0, cutoff)
      const keptTurns = turns.slice(cutoff)
      const messagesToCompress = flattenTurns(turnsToCompress)
      const keptMessages = flattenTurns(keptTurns)
      const summarize = config?.configurable?.summarize

      if (typeof summarize !== 'function' || !messagesToCompress.length) {
        return {
          updatedAt: nowIso()
        }
      }

      const nextSummary = normalizeTrimmedString(await summarize({
        existingSummary: state.summary,
        messages: messagesToCompress.map(toStoredMessage),
        maxChars: Math.max(1000, Number(maxSummaryChars) || 6000)
      }))

      if (!nextSummary) {
        return {
          updatedAt: nowIso()
        }
      }

      return {
        messages: [
          new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
          ...keptMessages
        ],
        summary: nextSummary,
        updatedAt: nowIso(),
        compressedTurnCount: turnsToCompress.length,
        keptTurnCount: keptTurns.length
      }
    })
    .addEdge(START, 'compact')
    .addEdge('compact', END)
    .compile({ checkpointer })

  async function getState(threadId) {
    const normalizedThreadId = normalizeTrimmedString(threadId)

    if (!normalizedThreadId) {
      return null
    }

    const snapshot = await graph.getState(createThreadConfig(normalizedThreadId))
    const values = snapshot?.values

    return values && Object.keys(values).length > 0 ? values : null
  }

  async function invoke(threadId, input, summarize) {
    const normalizedThreadId = normalizeTrimmedString(threadId)

    if (!normalizedThreadId) {
      throw new TypeError('Conversation memory requires a threadId.')
    }

    const config = createThreadConfig(normalizedThreadId)
    if (typeof summarize === 'function') {
      config.configurable.summarize = summarize
    }

    return graph.invoke(input, config)
  }

  async function initializeThread({
    threadId,
    messages = [],
    initialSummary = '',
    summarize
  } = {}) {
    const existingState = await getState(threadId)

    if (existingState) {
      return existingState
    }

    const normalizedMessages = (Array.isArray(messages) ? messages : [])
      .map(toLangChainMessage)
      .filter((message) => message.content)
    let input = {}

    const normalizedSummary = normalizeTrimmedString(initialSummary)

    if (normalizedSummary) {
      input.summary = normalizedSummary
    }

    if (normalizedMessages.length) {
      input.messages = normalizedMessages
    }

    if (!Object.keys(input).length) {
      return {
        messages: [],
        summary: normalizedSummary,
        updatedAt: null
      }
    }

    return invoke(threadId, input, summarize)
  }

  async function appendMessage(threadId, message, summarize) {
    const normalizedMessage = toLangChainMessage(message)

    if (!normalizedMessage.content) {
      return getState(threadId)
    }

    return invoke(threadId, { messages: [normalizedMessage] }, summarize)
  }

  function close() {
    db.close()
  }

  return {
    getState,
    initializeThread,
    appendMessage,
    toStoredMessage,
    close
  }
}

export function toConversationHistory(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map(toStoredMessage)
    .filter((message) => message.messageId && message.content)
}
