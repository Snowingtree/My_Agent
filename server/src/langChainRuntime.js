import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import {
  createAgent,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware
} from 'langchain'
import { createStructuredCompletion } from './llmClient.js'

const DEFAULT_TOOL_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: true
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeAction(value) {
  const normalized = normalizeString(value).toLowerCase()

  if (['tool', 'final', 'ask_user'].includes(normalized)) {
    return normalized
  }

  return 'final'
}

function normalizeDecision(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
  const nestedAction = source.action && typeof source.action === 'object'
    ? source.action
    : null
  const action = normalizeAction(
    nestedAction?.type
    || nestedAction?.action
    || source.action
    || source.type
  )
  const nestedTool = source.tool && typeof source.tool === 'object'
    ? source.tool
    : nestedAction?.tool && typeof nestedAction.tool === 'object'
      ? nestedAction.tool
      : null
  const toolName = normalizeString(
    nestedTool?.name
    || nestedAction?.name
    || (typeof nestedAction?.tool === 'string' ? nestedAction.tool : '')
    || source.name
    || (typeof source.tool === 'string' ? source.tool : '')
  )
  const rawArgs = nestedTool?.args ?? nestedAction?.args ?? source.args
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs
    : {}

  return {
    action: action === 'tool' && !toolName ? 'final' : action,
    thoughtSummary: normalizeString(
      source.thought_summary
      || source.thoughtSummary
      || nestedAction?.thought_summary
      || nestedAction?.thoughtSummary
    ),
    summary: normalizeString(source.summary || nestedAction?.summary),
    reply: normalizeString(
      source.reply
      || source.question
      || nestedAction?.reply
      || nestedAction?.question
    ),
    tool: toolName
      ? {
          name: toolName,
          args
        }
      : null
  }
}

function stringifyContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return content == null ? '' : JSON.stringify(content)
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }

      if (typeof item?.text === 'string') {
        return item.text
      }

      return item == null ? '' : JSON.stringify(item)
    })
    .filter(Boolean)
    .join('\n')
}

function getMessageType(message) {
  if (typeof message?._getType === 'function') {
    return message._getType()
  }

  return normalizeString(message?.role).toLowerCase()
}

function describeToolCalls(message) {
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : []

  if (!toolCalls.length) {
    return ''
  }

  return toolCalls
    .map((toolCall) => `Requested tool ${toolCall.name} with args ${JSON.stringify(toolCall.args || {})}`)
    .join('\n')
}

function toCompletionMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).flatMap((message) => {
    const type = getMessageType(message)
    const content = stringifyContent(message?.content)

    if (type === 'system') {
      return content ? [{ role: 'system', content }] : []
    }

    if (type === 'human' || type === 'user') {
      return content ? [{ role: 'user', content }] : []
    }

    if (type === 'tool') {
      const toolName = normalizeString(message?.name) || 'tool'
      return [{
        role: 'assistant',
        content: `LangChain tool observation (${toolName}):\n${content || '(empty result)'}`
      }]
    }

    if (type === 'ai' || type === 'assistant') {
      const toolCallText = describeToolCalls(message)
      const normalizedContent = [content, toolCallText].filter(Boolean).join('\n')
      return normalizedContent ? [{ role: 'assistant', content: normalizedContent }] : []
    }

    return content ? [{ role: 'user', content }] : []
  })
}

function toUsageMetadata(usage = {}) {
  const inputTokens = Number.isFinite(usage?.inputTokens) ? usage.inputTokens : null
  const outputTokens = Number.isFinite(usage?.outputTokens) ? usage.outputTokens : null
  const totalTokens = Number.isFinite(usage?.totalTokens)
    ? usage.totalTokens
    : inputTokens != null && outputTokens != null
      ? inputTokens + outputTokens
      : null

  if (inputTokens == null && outputTokens == null && totalTokens == null) {
    return undefined
  }

  return {
    input_tokens: inputTokens || 0,
    output_tokens: outputTokens || 0,
    total_tokens: totalTokens || 0
  }
}

function serializeToolSchema(tool) {
  const schema = tool?.schema || tool?.inputSchema || DEFAULT_TOOL_SCHEMA

  try {
    return JSON.stringify(schema)
  } catch {
    return JSON.stringify(DEFAULT_TOOL_SCHEMA)
  }
}

function buildToolCallingProtocol(tools = []) {
  const toolLines = tools.length
    ? tools.map((tool) => [
        `- ${tool.name}: ${tool.description || 'No description.'}`,
        `  Input schema: ${serializeToolSchema(tool)}`
      ].join('\n'))
    : ['- No tools are available.']

  return [
    'LangChain tool-calling adapter protocol:',
    'Return one strict JSON object only. Do not wrap it in Markdown.',
    'Choose exactly one action: "tool", "final", or "ask_user".',
    'For "tool", call exactly one bound LangChain tool using {"action":"tool","tool":{"name":"...","args":{...}}}.',
    'For "final", use {"action":"final","reply":""}; the server writes the final natural-language answer in a separate phase.',
    'For "ask_user", put one concise blocking question in "reply".',
    'Include a short safe "thought_summary" and public "summary". Never reveal private chain-of-thought.',
    'Bound LangChain tools:',
    ...toolLines
  ].join('\n')
}

function createToolCallId(state) {
  state.toolCallSequence += 1
  return `langchain_tool_${Date.now()}_${state.toolCallSequence}`
}

export class CompatibleLangChainChatModel extends BaseChatModel {
  constructor(fields = {}) {
    super(fields)
    this.aiConfig = fields.aiConfig
    this.model = fields.model
    this.requestTimeoutMs = fields.requestTimeoutMs
    this.idleTimeoutMs = fields.idleTimeoutMs
    this.streamResponses = fields.streamResponses
    this.timeoutRetries = fields.timeoutRetries
    this.timeoutRetryDelayMs = fields.timeoutRetryDelayMs
    this.signal = fields.signal
    this.boundTools = Array.isArray(fields.boundTools) ? fields.boundTools : []
    this.runtimeState = fields.runtimeState || {
      lastDecision: null,
      modelCalls: 0,
      toolCalls: 0,
      toolCallSequence: 0,
      usage: [],
      stopped: null
    }
    this.onDecision = typeof fields.onDecision === 'function' ? fields.onDecision : null
    this.structuredCompletion = fields.structuredCompletion || createStructuredCompletion
  }

  _llmType() {
    return 'my-agent-langchain-compatible-chat-model'
  }

  bindTools(tools = []) {
    return new CompatibleLangChainChatModel({
      aiConfig: this.aiConfig,
      model: this.model,
      requestTimeoutMs: this.requestTimeoutMs,
      idleTimeoutMs: this.idleTimeoutMs,
      streamResponses: this.streamResponses,
      timeoutRetries: this.timeoutRetries,
      timeoutRetryDelayMs: this.timeoutRetryDelayMs,
      signal: this.signal,
      boundTools: tools,
      runtimeState: this.runtimeState,
      onDecision: this.onDecision,
      structuredCompletion: this.structuredCompletion
    })
  }

  async _generate(messages) {
    if (this.runtimeState.stopped) {
      const message = new AIMessage({
        content: 'Agent execution paused by the existing tool safety harness.',
        additional_kwargs: {
          agent_action: 'halted'
        }
      })

      return {
        generations: [{ text: String(message.content), message }],
        llmOutput: {}
      }
    }

    const completionMessages = [
      ...toCompletionMessages(messages),
      {
        role: 'system',
        content: buildToolCallingProtocol(this.boundTools)
      }
    ]
    const completion = await this.structuredCompletion({
      aiConfig: this.aiConfig,
      model: this.model,
      requestTimeoutMs: this.requestTimeoutMs,
      idleTimeoutMs: this.idleTimeoutMs,
      streamResponses: this.streamResponses,
      timeoutRetries: this.timeoutRetries,
      timeoutRetryDelayMs: this.timeoutRetryDelayMs,
      signal: this.signal,
      messages: completionMessages
    })
    const decision = normalizeDecision(completion?.json)
    const usageMetadata = toUsageMetadata(completion?.usage)
    this.runtimeState.modelCalls += 1
    this.runtimeState.lastDecision = decision
    this.runtimeState.usage.push(completion?.usage || {})

    if (this.onDecision) {
      await this.onDecision({
        ...decision,
        usage: completion?.usage || {},
        modelCall: this.runtimeState.modelCalls
      })
    }

    let message

    if (decision.action === 'tool' && decision.tool) {
      message = new AIMessage({
        content: decision.thoughtSummary || decision.summary || `Calling ${decision.tool.name}.`,
        tool_calls: [{
          name: decision.tool.name,
          args: decision.tool.args,
          id: createToolCallId(this.runtimeState),
          type: 'tool_call'
        }],
        additional_kwargs: {
          agent_action: 'tool',
          agent_summary: decision.summary,
          thought_summary: decision.thoughtSummary
        },
        ...(usageMetadata ? { usage_metadata: usageMetadata } : {})
      })
    } else if (decision.action === 'ask_user') {
      message = new AIMessage({
        content: decision.reply || '我还缺少一项关键信息，你可以再补充一点吗？',
        additional_kwargs: {
          agent_action: 'ask_user',
          agent_summary: decision.summary,
          thought_summary: decision.thoughtSummary
        },
        ...(usageMetadata ? { usage_metadata: usageMetadata } : {})
      })
    } else {
      message = new AIMessage({
        content: 'The task is ready for the final response phase.',
        additional_kwargs: {
          agent_action: 'final',
          agent_summary: decision.summary,
          thought_summary: decision.thoughtSummary
        },
        ...(usageMetadata ? { usage_metadata: usageMetadata } : {})
      })
    }

    return {
      generations: [{ text: stringifyContent(message.content), message }],
      llmOutput: {
        usage: completion?.usage || {}
      }
    }
  }
}

function createObservation(result) {
  if (!result?.ok) {
    return {
      ok: false,
      waitingForApproval: Boolean(result?.waitingForApproval),
      failed: Boolean(result?.failed),
      message: result?.waitingForApproval
        ? 'The tool is waiting for user approval.'
        : 'The existing tool harness stopped the task.'
    }
  }

  const execution = result.toolExecution || {}
  return {
    ok: true,
    status: execution.status || 'success',
    summary: execution.summary || '',
    durationMs: Number.isFinite(execution.durationMs) ? execution.durationMs : undefined,
    result: execution.result
  }
}

function createLangChainTools(toolCatalog, executeTool, runtimeState) {
  return (Array.isArray(toolCatalog) ? toolCatalog : []).map((toolItem) => (
    new DynamicStructuredTool({
      name: toolItem.name,
      description: toolItem.description || 'Execute an existing My_Agent tool.',
      schema: toolItem.inputSchema || DEFAULT_TOOL_SCHEMA,
      func: async (args) => {
        runtimeState.toolCalls += 1
        const decision = runtimeState.lastDecision || {}
        const result = await executeTool({
          name: toolItem.name,
          args: args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        }, {
          summary: decision.summary || `正在执行工具 ${toolItem.name}。`,
          thoughtSummary: decision.thoughtSummary || ''
        })

        if (!result?.ok) {
          runtimeState.stopped = result
        }

        return JSON.stringify(createObservation(result))
      }
    })
  ))
}

export async function runLangChainAgent({
  aiConfig,
  model,
  messages = [],
  toolCatalog = [],
  executeTool,
  requestTimeoutMs,
  idleTimeoutMs,
  streamResponses,
  timeoutRetries,
  timeoutRetryDelayMs,
  signal,
  maxToolIterations = 6,
  onDecision,
  structuredCompletion
} = {}) {
  if (typeof executeTool !== 'function') {
    throw new TypeError('runLangChainAgent requires an executeTool function.')
  }

  const normalizedMaxIterations = Math.max(1, Number(maxToolIterations || 1))
  const runtimeState = {
    lastDecision: null,
    modelCalls: 0,
    toolCalls: 0,
    toolCallSequence: 0,
    usage: [],
    stopped: null
  }
  const tools = createLangChainTools(toolCatalog, executeTool, runtimeState)
  const chatModel = new CompatibleLangChainChatModel({
    aiConfig,
    model,
    requestTimeoutMs,
    idleTimeoutMs,
    streamResponses,
    timeoutRetries,
    timeoutRetryDelayMs,
    signal,
    runtimeState,
    onDecision,
    structuredCompletion
  })
  const agent = createAgent({
    model: chatModel,
    tools,
    middleware: [
      modelCallLimitMiddleware({
        runLimit: normalizedMaxIterations + 1,
        exitBehavior: 'end'
      }),
      toolCallLimitMiddleware({
        runLimit: normalizedMaxIterations,
        exitBehavior: 'end'
      })
    ]
  })
  const result = await agent.invoke({ messages }, { signal })

  return {
    messages: Array.isArray(result?.messages) ? result.messages : [],
    decision: runtimeState.lastDecision,
    stopped: runtimeState.stopped,
    modelCalls: runtimeState.modelCalls,
    toolCalls: runtimeState.toolCalls,
    usage: runtimeState.usage
  }
}
