export function runError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details })
}

// Stable categories are for routing/reporting. retryable never authorizes replaying a tool.
export function classifyRunFailure(error, { source = 'runtime' } = {}) {
  const code = String(error?.code || '')
  const message = String(error?.message || error || 'Unknown failure').slice(0, 500)
  let category = 'internal'
  let retryable = false
  if (code === 'BUDGET_EXHAUSTED') category = 'budget'
  else if (code === 'TASK_CANCELLED' || code === 'ABORT_ERR' || error?.name === 'AbortError') category = 'cancelled'
  else if (code === 'POLICY_DENIED') category = 'policy'
  else if (code === 'COMPLETION_REJECTED') category = 'validation'
  else if (code === 'RUN_INTERRUPTED') category = 'interrupted'
  else if (code === 'MODEL_PROTOCOL' || /malformed JSON|did not contain a JSON object|empty final answer/i.test(message)) category = 'model_protocol'
  else if (/timed? ?out|timeout/i.test(message)) { category = 'timeout'; retryable = true }
  else if (['ENOENT', 'EACCES', 'EPERM', 'ERR_DLOPEN_FAILED'].includes(code)) category = 'environment'
  else if (/429|502|503|504|ECONNRESET|fetch failed/i.test(message)) { category = 'external'; retryable = true }
  else if (source === 'tool') category = 'tool'
  else if (source === 'model') category = 'model'
  return { category, code: code || category.toUpperCase(), retryable, source, message,
    ...(error?.details?.dimension ? { dimension: error.details.dimension } : {}) }
}

// Many tools report a failure in their return value instead of throwing.
export function classifyToolResult(execution) {
  const result = execution?.result || {}
  const message = execution?.summary || result.message || 'Tool execution failed.'
  if (result.timedOut) return classifyRunFailure(runError('TOOL_TIMEOUT', 'Tool execution timed out.'), { source: 'tool' })
  if (result.blocked || execution?.status === 'blocked') {
    return classifyRunFailure(runError('POLICY_DENIED', message), { source: 'tool' })
  }
  if (result.isError || result.ok === false || execution?.status === 'failed'
      || (Object.hasOwn(result, 'exitCode') && result.exitCode !== 0)) {
    return classifyRunFailure(runError('TOOL_FAILED', message), { source: 'tool' })
  }
  return null
}
