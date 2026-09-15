import { createTextCompletion } from './llmClient.js'
import { runLangGraphAgent } from './langChainRuntime.js'
import { createId, normalizeTrimmedString } from './utils.js'

export const DELEGATE_TASK_TOOL_NAME = 'delegate_task'
export const READ_ONLY_SUB_AGENT_TOOL_NAMES = Object.freeze([
  'list_files',
  'read_file',
  'search_text'
])

const MAX_REPORT_CHARS = 6000
const MAX_EVIDENCE_CHARS = 12000

const SUB_AGENT_PROFILES = Object.freeze({
  code_reviewer: {
    label: '代码审查子 Agent',
    instructions: [
      'Review the requested code or workspace area for concrete correctness, security, regression, and maintainability risks.',
      'Use the read-only tools to gather evidence before making claims.',
      'Report findings ordered by severity. Include file paths and line numbers when the tool evidence permits it.',
      'Do not modify files, execute commands, invoke MCP, load Skills, access user memory, or contact external services.'
    ].join('\n')
  },
  document_curator: {
    label: '文档整理子 Agent',
    instructions: [
      'Inspect the requested documents or workspace area and produce a concise, structured organization or documentation recommendation.',
      'Use the read-only tools to gather evidence before making claims.',
      'Identify duplication, missing explanations, stale references, and a practical recommended outline or next action.',
      'Do not modify files, execute commands, invoke MCP, load Skills, access user memory, or contact external services.'
    ].join('\n')
  }
})

function clampPositiveInteger(value, fallbackValue, maximum) {
  const parsedValue = Number.parseInt(String(value ?? ''), 10)

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallbackValue
  }

  return Math.min(parsedValue, maximum)
}

function truncateText(value, maxChars) {
  const text = String(value ?? '')
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... [truncated]` : text
}

function toSafeReport(value) {
  return truncateText(normalizeTrimmedString(value), MAX_REPORT_CHARS)
}

function createDelegationToolDefinition() {
  return {
    name: DELEGATE_TASK_TOOL_NAME,
    description: 'Delegate a focused, read-only workspace investigation to a specialized sub-agent. Use code_reviewer for code review and document_curator for documentation organization. The sub-agent has an independent context, limited budget, and cannot modify files.',
    source: 'subagent',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: Object.keys(SUB_AGENT_PROFILES),
          description: 'The specialized sub-agent to delegate to.'
        },
        task: {
          type: 'string',
          description: 'A focused, self-contained delegation brief. Include paths or review scope when known.'
        }
      },
      required: ['agent', 'task'],
      additionalProperties: false
    }
  }
}

function buildSubAgentMessages({ profile, task, parentTaskId, subAgentId }) {
  return [
    {
      role: 'system',
      content: [
        `You are the ${profile.label} in a multi-agent workflow.`,
        'You are running in an isolated sub-agent context.',
        'You only know the delegation brief below; do not assume access to the parent conversation, long-term memory, Skills, MCP, or external services.',
        'You have only list_files, read_file, and search_text. They are read-only.',
        profile.instructions,
        'When you have enough evidence, choose final. Do not ask the user questions; report any limitation in your final report instead.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `Parent task ID: ${parentTaskId}`,
        `Sub-agent ID: ${subAgentId}`,
        'Delegation brief:',
        task
      ].join('\n')
    }
  ]
}

function buildReportMessages({ profile, task, evidence, result }) {
  return [
    {
      role: 'system',
      content: [
        `You are the ${profile.label}.`,
        'Write the final specialist report for the parent Agent in the same language as the delegation brief.',
        'Be concise and evidence-based. Do not mention hidden reasoning or invent evidence.',
        'This is a report for another agent, not a reply directly to the user.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        'Delegation brief:',
        task,
        '',
        'Collected tool evidence:',
        evidence || '(No tool output was needed or available.)',
        '',
        `Execution summary: ${result?.decision?.summary || result?.decision?.thoughtSummary || 'Sub-agent finished.'}`
      ].join('\n')
    }
  ]
}

function createChildAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort()

  if (parentSignal?.aborted) {
    controller.abort()
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  return {
    signal: controller.signal,
    didTimeOut: () => !parentSignal?.aborted && controller.signal.aborted,
    dispose: () => {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}

export function createSubAgentRuntime({
  toolRunner,
  config = {},
  runAgent = runLangGraphAgent,
  textCompletion = createTextCompletion
} = {}) {
  const enabled = config.enabled !== false
  const maxDelegationsPerTask = clampPositiveInteger(config.maxDelegationsPerTask, 3, 10)
  const maxToolIterations = clampPositiveInteger(config.maxToolIterations, 4, 12)
  const timeoutMs = clampPositiveInteger(config.timeoutMs, 180000, 900000)

  function getToolDefinition() {
    return enabled ? createDelegationToolDefinition() : null
  }

  async function delegate({
    sessionId,
    parentTaskId,
    parentExecutionId = '',
    agent,
    task,
    aiConfig,
    model,
    requestTimeoutMs,
    idleTimeoutMs,
    streamResponses,
    timeoutRetries,
    timeoutRetryDelayMs,
    signal,
    audit
  } = {}) {
    if (!enabled) {
      throw new Error('Sub-agent delegation is disabled.')
    }

    if (!toolRunner || typeof toolRunner.executeToolCall !== 'function') {
      throw new Error('Sub-agent delegation requires a tool runner.')
    }

    const normalizedAgent = normalizeTrimmedString(agent).toLowerCase()
    const profile = SUB_AGENT_PROFILES[normalizedAgent]
    const normalizedTask = normalizeTrimmedString(task)

    if (!profile) {
      throw new Error(`Unsupported sub-agent: ${normalizedAgent || '(empty)'}.`)
    }

    if (!normalizedTask) {
      throw new Error('delegate_task requires a non-empty task.')
    }

    const subAgentId = createId('subagent')
    const childSignal = createChildAbortSignal(signal, timeoutMs)
    const toolCatalog = toolRunner.getToolCatalog({
      allowedToolNames: READ_ONLY_SUB_AGENT_TOOL_NAMES
    })
    const evidence = []
    const usage = []
    const startedAt = Date.now()
    const log = typeof audit === 'function' ? audit : () => {}

    log('system_action', {
      action: 'subagent_started',
      parentTaskId,
      parentExecutionId,
      subAgentId,
      subAgentType: normalizedAgent,
      budget: {
        maxToolIterations,
        timeoutMs
      },
      allowedTools: READ_ONLY_SUB_AGENT_TOOL_NAMES
    })

    try {
      const result = await runAgent({
        aiConfig,
        model,
        messages: buildSubAgentMessages({
          profile,
          task: normalizedTask,
          parentTaskId,
          subAgentId
        }),
        toolCatalog,
        executeTool: async (toolRequest, metadata = {}) => {
          const toolName = normalizeTrimmedString(toolRequest?.name)

          if (!READ_ONLY_SUB_AGENT_TOOL_NAMES.includes(toolName)) {
            return {
              ok: false,
              failed: true,
              message: `Sub-agent is not allowed to call ${toolName || '(empty)'}.`
            }
          }

          const executionId = createId('subtool')
          const startedAtMs = Date.now()
          log('tool_call', {
            executionId,
            parentTaskId,
            parentExecutionId,
            subAgentId,
            subAgentType: normalizedAgent,
            tool: toolName,
            args: toolRequest?.args || {},
            thoughtSummary: metadata?.thoughtSummary || '',
            status: 'started'
          })

          try {
            const toolExecution = await toolRunner.executeToolCall(toolRequest, {
              sessionId,
              allowedToolNames: READ_ONLY_SUB_AGENT_TOOL_NAMES,
              signal: childSignal.signal
            })
            const observation = truncateText(toolExecution.message || toolExecution.summary, 4000)
            evidence.push(`Tool: ${toolExecution.tool}\n${observation}`)
            log('tool_result', {
              executionId,
              parentTaskId,
              parentExecutionId,
              subAgentId,
              subAgentType: normalizedAgent,
              tool: toolExecution.tool,
              status: 'success',
              durationMs: Date.now() - startedAtMs,
              summary: toolExecution.summary
            })

            return {
              ok: true,
              toolExecution: {
                ...toolExecution,
                status: 'success',
                durationMs: Date.now() - startedAtMs
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error || 'Sub-agent tool failed.')
            log('error', {
              scope: 'subagent_tool',
              executionId,
              parentTaskId,
              parentExecutionId,
              subAgentId,
              subAgentType: normalizedAgent,
              tool: toolName,
              message
            })
            return {
              ok: false,
              failed: true,
              message
            }
          }
        },
        requestTimeoutMs,
        idleTimeoutMs,
        streamResponses,
        timeoutRetries,
        timeoutRetryDelayMs,
        signal: childSignal.signal,
        maxToolIterations,
        onDecision: async (decision) => {
          usage.push(decision?.usage || {})
          log('llm_decision', {
            stage: 'subagent',
            parentTaskId,
            parentExecutionId,
            subAgentId,
            subAgentType: normalizedAgent,
            model,
            modelCall: decision?.modelCall,
            action: decision?.action,
            summary: decision?.summary || '',
            thoughtSummary: decision?.thoughtSummary || ''
          })
        }
      })

      if (childSignal.didTimeOut()) {
        throw new Error(`Sub-agent exceeded its ${Math.ceil(timeoutMs / 1000)} second budget.`)
      }

      const evidenceText = truncateText(evidence.join('\n\n'), MAX_EVIDENCE_CHARS)
      log('llm_input', {
        stage: 'subagent_report',
        parentTaskId,
        parentExecutionId,
        subAgentId,
        subAgentType: normalizedAgent,
        model,
        evidenceCount: evidence.length
      })
      const completion = await textCompletion({
        aiConfig,
        model,
        messages: buildReportMessages({
          profile,
          task: normalizedTask,
          evidence: evidenceText,
          result
        }),
        requestTimeoutMs,
        idleTimeoutMs,
        streamResponses: false,
        timeoutRetries,
        timeoutRetryDelayMs,
        signal: childSignal.signal
      })
      const report = toSafeReport(completion?.text || completion?.rawText)

      if (!report) {
        throw new Error('Sub-agent returned an empty report.')
      }

      const durationMs = Date.now() - startedAt
      const resultPayload = {
        subAgentId,
        agent: normalizedAgent,
        label: profile.label,
        parentTaskId,
        report,
        modelCalls: Number(result?.modelCalls || 0),
        toolCalls: Number(result?.toolCalls || 0),
        usage,
        durationMs,
        budget: {
          maxToolIterations,
          timeoutMs,
          maxDelegationsPerTask
        },
        allowedTools: READ_ONLY_SUB_AGENT_TOOL_NAMES
      }

      log('system_action', {
        action: 'subagent_completed',
        parentTaskId,
        parentExecutionId,
        subAgentId,
        subAgentType: normalizedAgent,
        modelCalls: resultPayload.modelCalls,
        toolCalls: resultPayload.toolCalls,
        durationMs
      })

      return resultPayload
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Sub-agent failed.')
      log('error', {
        scope: 'subagent',
        parentTaskId,
        parentExecutionId,
        subAgentId,
        subAgentType: normalizedAgent,
        message
      })
      log('system_action', {
        action: 'subagent_failed',
        parentTaskId,
        parentExecutionId,
        subAgentId,
        subAgentType: normalizedAgent,
        message
      })
      throw error
    } finally {
      childSignal.dispose()
    }
  }

  return {
    enabled,
    maxDelegationsPerTask,
    getToolDefinition,
    delegate
  }
}
