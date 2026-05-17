import { createHash } from 'node:crypto'

function normalizeTrimmedString(value) {
  return String(value ?? '').trim()
}

function cloneJsonValue(value) {
  if (value == null) {
    return value
  }

  return JSON.parse(JSON.stringify(value))
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonValue(value[key])])
    )
  }

  return value
}

function stableStringify(value) {
  return JSON.stringify(sortJsonValue(value))
}

export function stripToolControlArgs(args = {}) {
  const normalizedArgs = args && typeof args === 'object' && !Array.isArray(args)
    ? cloneJsonValue(args)
    : {}

  delete normalizedArgs.mode
  delete normalizedArgs.approvalId

  return normalizedArgs
}

export function createToolApprovalFingerprint(toolName, args = {}) {
  return createHash('sha256')
    .update(stableStringify({
      tool: normalizeTrimmedString(toolName),
      args: stripToolControlArgs(args)
    }))
    .digest('hex')
}

export function doesToolApprovalMatch(approval, toolName, args = {}) {
  const normalizedApprovalTool = normalizeTrimmedString(approval?.tool)
  const normalizedToolName = normalizeTrimmedString(toolName)

  return (
    normalizedApprovalTool
    && normalizedApprovalTool === normalizedToolName
    && normalizeTrimmedString(approval?.fingerprint) === createToolApprovalFingerprint(toolName, args)
  )
}

function truncateText(value, maxLength = 900) {
  const normalized = String(value ?? '')

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}\n...truncated...`
}

function formatArgPreview(args = {}) {
  const safeArgs = stripToolControlArgs(args)

  if (Object.keys(safeArgs).length === 0) {
    return '(empty)'
  }

  return truncateText(JSON.stringify(safeArgs, null, 2), 1200)
}

export function formatToolApprovalRequestMessage(approval = {}) {
  const warnings = Array.isArray(approval.policy?.warnings)
    ? approval.policy.warnings.filter(Boolean)
    : []
  const reason = normalizeTrimmedString(approval.reason)
  const riskLevel = normalizeTrimmedString(approval.riskLevel) || 'high'

  return [
    '需要你确认后才能继续执行这个受保护操作。',
    '',
    `工具：${approval.tool || 'unknown_tool'}`,
    `风险等级：${riskLevel}`,
    reason ? `原因：${reason}` : '',
    warnings.length ? `风险提示：${warnings.join('；')}` : '',
    '',
    '参数预览：',
    '```json',
    formatArgPreview(approval.args),
    '```',
    '',
    '回复“确认执行”继续，回复“取消执行”放弃这次操作。'
  ].filter((line) => line !== '').join('\n')
}

export function isToolApprovalConfirmation(value) {
  const normalized = normalizeTrimmedString(value).toLowerCase()

  if (!normalized || normalized.length > 80) {
    return false
  }

  return (
    /^(确认|确认执行|同意|同意执行|批准|批准执行|可以|可以执行|继续|继续执行|执行吧|运行吧)$/.test(normalized)
    || /^(yes|y|ok|okay|approve|approved|confirm|confirmed|run|go ahead|continue)$/i.test(normalized)
  )
}

export function isToolApprovalDenial(value) {
  const normalized = normalizeTrimmedString(value).toLowerCase()

  if (!normalized || normalized.length > 80) {
    return false
  }

  return (
    /^(取消|取消执行|拒绝|不要|别执行|不执行|停止|停止执行|放弃)$/.test(normalized)
    || /^(no|n|cancel|deny|denied|reject|rejected|stop)$/i.test(normalized)
  )
}
