import { readFile } from 'node:fs/promises'
import { createStructuredCompletion } from './llmClient.js'
import {
  createId,
  createTaskStep,
  getRecentMessages,
  isRunningTaskStatus,
  normalizeTrimmedString,
  nowIso,
  sleep,
  truncateText
} from './utils.js'

const WRITE_TOOL_NAMES = new Set(['write_file', 'apply_patch'])
const TASK_CANCELLED_CODE = 'TASK_CANCELLED'
const FILE_CHANGE_REQUEST_PATTERNS = [
  /修改文件|写入文件|新增文件|新建文件|创建文件|删除文件|改代码|写代码|生成文件|保存到文件|落文件|更新文件|重写文件|补丁/i,
  /\b(create|write|modify|edit|rewrite|update|delete|remove|save)\b.*\b(file|code|component|script|module)\b/i,
  /\b(file|code|component|script|module)\b.*\b(create|write|modify|edit|rewrite|update|delete|remove|save)\b/i
]

const UI_FILE_CHANGE_REQUEST_PATTERNS = [
  /\u5199\u4ee3\u7801|\u6539\u4ee3\u7801|\u751f\u6210\u4ee3\u7801|\u521b\u5efa\u4ee3\u7801|\u5199\u4e00\u4e2a\u9875\u9762|\u5199\u4e2a\u9875\u9762|\u5199\u4e00\u4e2a\u7f51\u9875|\u5199\u4e2a\u7f51\u9875|\u65b0\u5efa\u9875\u9762|\u521b\u5efa\u9875\u9762|\u505a\u4e00\u4e2a\u9875\u9762|\u505a\u4e2a\u9875\u9762|\u505a\u4e00\u4e2a\u754c\u9762|\u505a\u4e2a\u754c\u9762|\u5199\u4e00\u4e2a\u754c\u9762|\u5199\u4e2a\u754c\u9762|\u521b\u5efa\u754c\u9762|\u751f\u6210\u9875\u9762|\u751f\u6210\u754c\u9762|\u521b\u5efa\u7ec4\u4ef6|\u65b0\u5efa\u7ec4\u4ef6|\u5199\u4e00\u4e2a\u7ec4\u4ef6|\u5199\u4e2a\u7ec4\u4ef6|\u5199\u4e00\u4e2a\u811a\u672c|\u5199\u4e2a\u811a\u672c|\u5199\u4e00\u4e2a html|\u5199\u4e00\u4e2a vue|\u5199\u4e00\u4e2a python|\u5199\u4e00\u4e2a py/i,
  /\b(create|build|make|generate|write)\b.*\b(page|webpage|ui|interface|html|css|javascript|js|python|py|vue|react|component|script)\b/i,
  /\b(page|ui|interface|html|css|javascript|js|vue|react|component)\b.*\b(create|build|make|generate|write)\b/i
]

const FILE_MUTATION_HINT_PATTERNS = [
  /修改|删除|替换|分离|抽离|拆分|拆出|提取|创建|新建|生成|保存|写入|更新|重写|引入|引用|添加|追加/,
  /\b(edit|modify|delete|remove|replace|split|extract|separate|create|generate|save|write|update|rewrite|link|import|add)\b/i
]

const FILE_CHANGE_CONFIRMATION_PATTERNS = [
  /\b(created|generated|saved|updated|modified|rewritten|split|extracted|separated)\b/i,
  /已经[^。；\n]{0,24}(创建|生成|保存|写入|修改|更新|分离|拆分|抽离|完成)/,
  /已[^。；\n]{0,24}(创建|生成|保存|写入|修改|更新|分离|拆分|抽离|完成)/,
  /我已经[^。；\n]{0,32}(创建|生成|保存|写入|修改|更新|分离|拆分|抽离|完成)/,
  /文件已[^。；\n]{0,24}(创建|生成|保存|写入|修改|更新)/
]

const SAFE_FILE_CHANGE_REQUEST_PATTERNS = [
  /(?:\u4fee\u6539\u6587\u4ef6|\u5199\u5165\u6587\u4ef6|\u65b0\u589e\u6587\u4ef6|\u65b0\u5efa\u6587\u4ef6|\u521b\u5efa\u6587\u4ef6|\u5220\u9664\u6587\u4ef6|\u6539\u4ee3\u7801|\u5199\u4ee3\u7801|\u5199\u4e00\u4e2a\u9875\u9762|\u5199\u4e2a\u9875\u9762|\u5199\u4e00\u4e2a\u7f51\u9875|\u5199\u4e2a\u7f51\u9875|\u5199\u4e00\u4e2a\u754c\u9762|\u5199\u4e2a\u754c\u9762|\u5199\u4e00\u4e2a\u7ec4\u4ef6|\u5199\u4e2a\u7ec4\u4ef6|\u5199\u4e00\u4e2a\u811a\u672c|\u5199\u4e2a\u811a\u672c|\u751f\u6210\u6587\u4ef6|\u4fdd\u5b58\u5230\u6587\u4ef6|\u843d\u5730\u6587\u4ef6|\u66f4\u65b0\u6587\u4ef6|\u91cd\u5199\u6587\u4ef6|\u8865\u4e01)/i,
  /\b(create|write|modify|edit|rewrite|update|delete|remove|save)\b.*\b(file|code|component|script|module|page|webpage|ui|interface)\b/i,
  /\b(file|code|component|script|module|page|webpage|ui|interface)\b.*\b(create|write|modify|edit|rewrite|update|delete|remove|save)\b/i
]

const SAFE_FILE_MUTATION_HINT_PATTERNS = [
  /(?:\u4fee\u6539|\u5220\u9664|\u66ff\u6362|\u5206\u79bb|\u62bd\u79bb|\u62c6\u5206|\u62c6\u51fa|\u63d0\u53d6|\u521b\u5efa|\u65b0\u5efa|\u751f\u6210|\u4fdd\u5b58|\u5199\u5165|\u66f4\u65b0|\u91cd\u5199|\u5f15\u5165|\u5f15\u7528|\u6dfb\u52a0|\u8ffd\u52a0)/,
  /\b(edit|modify|delete|remove|replace|split|extract|separate|create|generate|save|write|update|rewrite|link|import|add)\b/i
]

const SAFE_FILE_CHANGE_CONFIRMATION_PATTERNS = [
  /\b(created|generated|saved|updated|modified|rewritten|split|extracted|separated|added|imported|linked)\b/i,
  /(?:\u5df2\u7ecf|\u5df2|\u6211\u5df2\u7ecf|\u6211\u5df2|\u6587\u4ef6\u5df2)(?:[^\n\u3002\uff1b]{0,32})?(?:\u521b\u5efa|\u751f\u6210|\u4fdd\u5b58|\u5199\u5165|\u4fee\u6539|\u66f4\u65b0|\u5206\u79bb|\u62c6\u5206|\u62bd\u79bb|\u5b8c\u6210|\u5f15\u5165|\u5f15\u7528|\u5220\u9664|\u6dfb\u52a0)/
]

const SAFE_SPLIT_MARKERS = [
  '\u5206\u79bb',
  '\u62bd\u79bb',
  '\u62c6\u5206',
  '\u62c6\u51fa',
  '\u63d0\u53d6',
  '\u72ec\u7acb',
  'split',
  'extract',
  'separate'
]

function toChatHistory(messages) {
  return messages.flatMap((message) => {
    const role = normalizeTrimmedString(message?.role).toLowerCase()
    const content = String(message?.content ?? '')

    if (!content) {
      return []
    }

    if (role === 'assistant' || role === 'user') {
      return [{
        role,
        content
      }]
    }

    if (role === 'tool') {
      return [{
        role: 'assistant',
        content: `工具摘要：\n${content}`
      }]
    }

    return []
  })
}

function toChatHistorySafe(messages) {
  return messages.flatMap((message) => {
    const role = normalizeTrimmedString(message?.role).toLowerCase()
    const content = String(message?.content ?? '')

    if (!content) {
      return []
    }

    if (role === 'assistant' || role === 'user') {
      return [{
        role,
        content
      }]
    }

    if (role === 'tool') {
      return [{
        role: 'assistant',
        content: `工具摘要：\n${content}`
      }]
    }

    return []
  })
}

function looksLikeFileChangeRequestSafe(value) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return false
  }

  const hasExplicitPaths = extractExplicitFilePaths(normalized).length > 0
  const hasMutationHint = SAFE_FILE_MUTATION_HINT_PATTERNS.some((pattern) => pattern.test(normalized))
  const hasCompanionFileRequirement = getRequiredCompanionExtensionsSafe(normalized).length > 0

  return (
    (hasExplicitPaths && hasMutationHint)
    || hasCompanionFileRequirement
    || SAFE_FILE_CHANGE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))
    || UI_FILE_CHANGE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))
  )
}

function looksLikeCompletedFileChangeClaimSafe(value) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return false
  }

  const hasConfirmationPattern = SAFE_FILE_CHANGE_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(normalized))
  const mentionsFilePath = extractExplicitFilePaths(normalized).length > 0
  const mentionsMutationHint = SAFE_FILE_MUTATION_HINT_PATTERNS.some((pattern) => pattern.test(normalized))

  return hasConfirmationPattern || (mentionsFilePath && mentionsMutationHint)
}

function getRequiredCompanionExtensionsSafe(value) {
  const normalized = normalizeTrimmedString(value).toLowerCase()
  const required = []

  if (SAFE_SPLIT_MARKERS.some((marker) => normalized.includes(marker)) && ['css', '\u6837\u5f0f', 'style'].some((marker) => normalized.includes(marker))) {
    required.push('.css')
  }

  if (SAFE_SPLIT_MARKERS.some((marker) => normalized.includes(marker)) && ['js', 'javascript', '\u811a\u672c', 'script'].some((marker) => normalized.includes(marker))) {
    required.push('.js')
  }

  return required
}

function normalizeAction(value) {
  return normalizeTrimmedString(value).toLowerCase()
}

function looksLikeFileChangeRequest(value) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return false
  }

  const hasExplicitPaths = extractExplicitFilePaths(normalized).length > 0
  const hasMutationHint = FILE_MUTATION_HINT_PATTERNS.some((pattern) => pattern.test(normalized))
  const hasCompanionFileRequirement = getRequiredCompanionExtensions(normalized).length > 0

  return (
    (hasExplicitPaths && hasMutationHint)
    || hasCompanionFileRequirement
    || FILE_CHANGE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))
    || UI_FILE_CHANGE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))
  )
}

function looksLikeCompletedFileChangeClaim(value) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return false
  }

  return FILE_CHANGE_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(normalized))
}

function extractExplicitFilePaths(value) {
  const matches = String(value || '').matchAll(/([A-Za-z0-9_./-]+\.(html|css|js|ts|tsx|jsx|vue|json|md|txt))/ig)
  const paths = []
  const seen = new Set()

  for (const match of matches) {
    const nextPath = normalizeTrimmedString(match?.[1]).replace(/\\/g, '/')

    if (!nextPath || seen.has(nextPath)) {
      continue
    }

    seen.add(nextPath)
    paths.push(nextPath)
  }

  return paths
}

function getRequiredCompanionExtensions(value) {
  const normalized = normalizeTrimmedString(value).toLowerCase()
  const required = []
  const splitMarkers = ['分离', '抽离', '拆分', '拆出', '提取', '独立']

  if (splitMarkers.some((marker) => normalized.includes(marker)) && ['css', '样式', 'style'].some((marker) => normalized.includes(marker))) {
    required.push('.css')
  }

  if (splitMarkers.some((marker) => normalized.includes(marker)) && ['js', 'javascript', '脚本', 'script'].some((marker) => normalized.includes(marker))) {
    required.push('.js')
  }

  return required
}

function hasRequiredCompanionChanges(requiredExtensions = [], changedFiles = []) {
  if (!requiredExtensions.length) {
    return true
  }

  const normalizedChangedFiles = (Array.isArray(changedFiles) ? changedFiles : [])
    .map((item) => normalizeTrimmedString(item).toLowerCase())
    .filter(Boolean)

  return requiredExtensions.every((extension) => (
    normalizedChangedFiles.some((filePath) => filePath.endsWith(extension))
  ))
}

async function buildWorkspaceSnapshotText({
  sessionId,
  latestGoal,
  changedFiles = [],
  sessionRepository,
  sessionWorkspaces
} = {}) {
  if (!sessionId || !sessionRepository || !sessionWorkspaces) {
    return ''
  }

  const activeSession = await sessionRepository.getSession(sessionId)
  const trackedWorkspaceFiles = Array.isArray(activeSession?.workspaceFiles) ? activeSession.workspaceFiles : []
  const workspaceFiles = await sessionWorkspaces.listWorkspaceFiles(sessionId, trackedWorkspaceFiles)
  const lines = [
    `Current session workspace folder: ${sessionWorkspaces.getWorkspaceFolderLabel(sessionId)}`
  ]

  if (!workspaceFiles.length) {
    lines.push('Current session workspace files: (empty)')
    return lines.join('\n')
  }

  lines.push('Current session workspace files:')

  for (const [index, file] of workspaceFiles.slice(0, 40).entries()) {
    lines.push(`${index + 1}. ${file.path}`)
  }

  if (workspaceFiles.length > 40) {
    lines.push(`...and ${workspaceFiles.length - 40} more file(s).`)
  }

  const explicitPaths = extractExplicitFilePaths(latestGoal)
  const previewPaths = Array.from(new Set([
    ...explicitPaths,
    ...changedFiles,
    ...workspaceFiles.map((item) => normalizeTrimmedString(item?.path))
  ].filter(Boolean))).slice(0, 3)

  const previewBlocks = []

  for (const targetPath of previewPaths) {
    try {
      const preview = await sessionWorkspaces.readWorkspaceFile(sessionId, targetPath, 3200)
      previewBlocks.push([
        `File preview: ${targetPath}`,
        truncateText(preview.content, 1600)
      ].join('\n'))
    } catch {}
  }

  if (previewBlocks.length) {
    lines.push('Relevant file previews:')
    lines.push(previewBlocks.join('\n\n'))
  }

  return lines.join('\n')
}

function buildAttachmentContextText(attachments = []) {
  const normalizedAttachments = Array.isArray(attachments)
    ? attachments.filter(Boolean)
    : []

  if (!normalizedAttachments.length) {
    return ''
  }

  const lines = [
    'Ephemeral uploaded files are available for this conversation only.',
    'They are not persisted to the workspace or session storage on the server.',
    'Use them as read-only reference material unless you explicitly write new workspace files.'
  ]
  let remainingChars = 60000

  normalizedAttachments.slice(0, 8).forEach((item, index) => {
    if (remainingChars <= 0) {
      return
    }

    const header = `${index + 1}. ${item.name}${item.type ? ` (${item.type})` : ''}${Number.isFinite(item.sizeBytes) ? ` - ${item.sizeBytes} bytes` : ''}`
    const rawContent = String(item.content || '')
    const safeContent = rawContent.length > 20000
      ? `${rawContent.slice(0, 20000)}\n...truncated...`
      : rawContent
    const nextBlock = [
      header,
      'Content:',
      safeContent
    ].join('\n')

    if (nextBlock.length > remainingChars) {
      lines.push(nextBlock.slice(0, remainingChars))
      remainingChars = 0
      return
    }

    lines.push(nextBlock)
    remainingChars -= nextBlock.length
  })

  return lines.join('\n\n')
}

function buildActiveSkillPrompt(skills) {
  const normalizedSkills = (Array.isArray(skills) ? skills : [])
    .filter(Boolean)

  if (!normalizedSkills.length) {
    return ''
  }

  return normalizedSkills.map((skill) => {
    const promptSections = [
      `Active skill: ${skill.name} (${skill.skillId}).`
    ]

    if (skill.description) {
      promptSections.push(`Skill purpose: ${skill.description}`)
    }

    if (skill.instruction) {
      promptSections.push(`Skill instruction: ${skill.instruction}`)
    }

    if (Array.isArray(skill.preferredTools) && skill.preferredTools.length) {
      promptSections.push(`Prefer these tools or namespaces when relevant: ${skill.preferredTools.join(', ')}`)
    }

    if (Array.isArray(skill.allowedTools) && skill.allowedTools.length) {
      promptSections.push(`Only use these tools or namespaces: ${skill.allowedTools.join(', ')}`)
    }

    if (Array.isArray(skill.disabledTools) && skill.disabledTools.length) {
      promptSections.push(`Never use these tools or namespaces: ${skill.disabledTools.join(', ')}`)
    }

    return promptSections.join('\n')
  }).join('\n\n')
}

function mergeActiveSkills(skills) {
  const normalizedSkills = (Array.isArray(skills) ? skills : []).filter(Boolean)

  if (!normalizedSkills.length) {
    return null
  }

  if (normalizedSkills.length === 1) {
    return normalizedSkills[0]
  }

  const unique = (items) => [...new Set((Array.isArray(items) ? items : []).filter(Boolean))]

  return {
    skillId: normalizedSkills.map((item) => item.skillId).join('+'),
    name: normalizedSkills.map((item) => item.name).join(' + '),
    description: normalizedSkills
      .map((item) => normalizeTrimmedString(item.description))
      .filter(Boolean)
      .join(' | '),
    instruction: normalizedSkills
      .map((item) => normalizeTrimmedString(item.instruction))
      .filter(Boolean)
      .join('\n\n'),
    preferredTools: unique(normalizedSkills.flatMap((item) => item.preferredTools || [])),
    allowedTools: unique(normalizedSkills.flatMap((item) => item.allowedTools || [])),
    disabledTools: unique(normalizedSkills.flatMap((item) => item.disabledTools || []))
  }
}

function looksLikeToolSummaryContent(value) {
  const normalized = normalizeTrimmedString(value).toLowerCase()
  return normalized.includes('tool summary:')
}

function looksLikeCodeHeavyContent(value) {
  const normalized = normalizeTrimmedString(value).toLowerCase()

  if (!normalized) {
    return false
  }

  const highConfidenceMarkers = [
    '<!doctype html',
    '<html',
    'export default',
    'body {',
    '.container {'
  ]

  if (highConfidenceMarkers.some((marker) => normalized.includes(marker))) {
    return true
  }

  const codeBlockMatch = normalized.match(/```/g)

  if (codeBlockMatch && codeBlockMatch.length >= 2) {
    return true
  }

  const hasStyleOrScriptBlock = (
    (normalized.includes('<style') && normalized.includes('</style>'))
    || (normalized.includes('<script') && normalized.includes('</script>'))
    || (normalized.includes('<template>') && normalized.includes('</template>'))
  )

  if (hasStyleOrScriptBlock) {
    return true
  }

  const lineCount = normalized.split(/\r?\n/).length
  const isLongEnough = normalized.length >= 220 || lineCount >= 8

  return isLongEnough && highConfidenceMarkers.some((marker) => normalized.includes(marker))
}

function extractCodeFence(value) {
  const normalized = String(value || '')
  const match = normalized.match(/```([a-zA-Z0-9_-]*)\s*([\s\S]+?)```/)

  if (!match) {
    return null
  }

  return {
    language: normalizeTrimmedString(match[1]).toLowerCase(),
    content: String(match[2] || '').trim()
  }
}

function inferFilePathFromReply(latestGoal, replyContent) {
  const explicitPaths = extractExplicitFilePaths(latestGoal)

  if (explicitPaths.length) {
    return explicitPaths[0]
  }

  const normalizedReply = normalizeTrimmedString(replyContent).toLowerCase()

  if (!normalizedReply) {
    return ''
  }

  if (normalizedReply.includes('<!doctype html') || normalizedReply.includes('<html')) {
    return 'index.html'
  }

  if (
    normalizedReply.includes('<template>')
    || normalizedReply.includes('</template>')
    || normalizedReply.includes('export default')
  ) {
    return 'App.vue'
  }

  if (
    normalizedReply.includes('body {')
    || normalizedReply.includes('@media')
    || normalizedReply.includes('.container')
    || normalizedReply.includes(':root {')
  ) {
    return 'styles.css'
  }

  if (
    normalizedReply.includes('function ')
    || normalizedReply.includes('const ')
    || normalizedReply.includes('document.')
    || normalizedReply.includes('addEventListener(')
  ) {
    return 'main.js'
  }

  return ''
}

function extractWritableContentFromReply(reply) {
  const normalizedReply = String(reply || '').trim()

  if (!normalizedReply) {
    return {
      content: '',
      language: ''
    }
  }

  const fencedCode = extractCodeFence(normalizedReply)

  if (fencedCode?.content) {
    return fencedCode
  }

  const htmlStartIndex = normalizedReply.search(/<!doctype html|<html/i)

  if (htmlStartIndex >= 0) {
    return {
      content: normalizedReply.slice(htmlStartIndex).trim(),
      language: 'html'
    }
  }

  if (looksLikeCodeHeavyContent(normalizedReply)) {
    return {
      content: normalizedReply,
      language: ''
    }
  }

  return {
    content: '',
    language: ''
  }
}

function stripWrappingCodeFences(value) {
  const trimmed = String(value || '').trim()
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]+?)\n?```\s*$/)

  if (match?.[1]) {
    return match[1].trim()
  }

  return trimmed
}

function buildSafeAssistantReply({
  reply = '',
  fileChangesRequired = false,
  modifiedWorkspace = false,
  changedFiles = [],
  verifiedAfterModification = false
} = {}) {
  const normalizedReply = stripWrappingCodeFences(normalizeTrimmedString(reply))

  if (modifiedWorkspace) {
    return buildWorkspaceCompletionReply({
      changedFiles,
      verifiedAfterModification
    })
  }

  if (fileChangesRequired && (looksLikeToolSummaryContent(normalizedReply) || looksLikeCodeHeavyContent(normalizedReply))) {
    return '本次请求需要直接修改文件。当前不再展示代码正文，请继续查看右侧会话文件；如果右侧没有新文件，说明本次修改还未真正完成。'
  }

  if (looksLikeToolSummaryContent(normalizedReply)) {
    return '本轮主要执行了工具操作，详细代码和文件内容请查看右侧会话文件。'
  }

  return normalizedReply
}

function buildCurrentDateContext(timeZone = 'Asia/Shanghai') {
  const now = new Date()
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })

  return [
    `Current server date: ${dateFormatter.format(now)}`,
    `Current server time: ${timeFormatter.format(now)}`,
    `Time zone: ${timeZone}`,
    'Use this current date and time for ordinary conversational questions such as today, weekday, current date, or current time.',
    'Do not say that you lack access to the current date or time when this information is provided here.'
  ].join('\n')
}

function serializeJson(value, maxChars = 12000) {
  const serialized = JSON.stringify(value, null, 2)
  return serialized.length > maxChars
    ? `${serialized.slice(0, maxChars)}\n...truncated...`
    : serialized
}

function buildAgentLoopMessages({
  latestGoal,
  conversationHistory,
  requireFileChanges = false,
  toolMessages,
  toolPromptText,
  systemPrompt,
  remainingIterations,
  workspaceContextText = '',
  attachmentContextText = '',
  currentDateContextText = ''
}) {
  const promptSections = [
    'You are a coding agent running inside a server workspace.',
    'The current session workspace is the only source of truth for this task.',
    'When the user asks to continue modifying previous files, continue working on files that already exist inside the current session workspace.',
    'The user may ask for coding work, workspace investigation, product discussion, brainstorming, or ordinary conversation.',
    'Return strict JSON only.',
    'Do not expose hidden chain-of-thought.',
    'Use the same language as the user.',
    'For ordinary conversation, answer naturally and directly instead of refusing unnecessarily.',
    'You may decide one of three actions on each turn:',
    '- "tool": call exactly one available tool when you need workspace evidence.',
    '- "final": provide the final user-facing answer when you have enough information.',
    '- "ask_user": ask exactly one concise clarification question when the task is blocked by missing information.',
    'Use "final" for greetings, everyday Q&A, explanations, brainstorming, summaries, translations, or any request that does not require workspace inspection.',
    'Do not force tool usage when a direct answer is sufficient.',
    'Do not ask clarifying questions unless the missing detail truly blocks a useful next response.',
    'When the user asks for the current date, weekday, or time, use the provided current date context directly.',
    'When the request is about the codebase or file changes, prefer inspecting the workspace before making code claims.',
    'If ephemeral uploaded files are provided, treat them as conversation-scoped reference material for this run.',
    'Use apply_patch for targeted edits and write_file for new files or full rewrites.',
    'Never claim that a file changed unless a write tool actually succeeded.',
    'When you modify files and a verification command is available, expect a follow-up verification step before the final answer.',
    ...(requireFileChanges
      ? [
          'This request appears to ask for real file changes.',
          'You must use workspace tools and actually create, modify, or delete files before choosing "final", unless the task is blocked by missing information.',
          'Do not place the intended code only in reply text when a file change is required.',
          'When the user asks for a page, UI, component, script, or HTML/CSS/JS implementation without giving an explicit path, choose a sensible default filename in the current workspace and write the file directly.',
          'If the current session workspace already contains related files, inspect and continue modifying those existing files instead of starting over.',
          'If the user asks to split CSS or JS into separate files, do not finish until the companion file is actually written and the original file references it correctly.'
        ]
      : []),
    `You have ${remainingIterations} tool iteration(s) remaining before you must finish.`,
    'Available tools:',
    toolPromptText,
    'JSON schema:',
    '{',
    '  "action": "tool" | "final" | "ask_user",',
    '  "summary": "short public progress update",',
    '  "reply": "required for final or ask_user, otherwise empty",',
    '  "tool": {',
    '    "name": "tool name when action is tool",',
    '    "args": {}',
    '  }',
    '}'
  ]

  if (systemPrompt) {
    promptSections.push(`Additional behavior preference: ${systemPrompt}`)
  }

  return [
    {
      role: 'system',
      content: promptSections.join('\n')
    },
    ...(currentDateContextText
      ? [{
          role: 'user',
          content: `Current date context:\n${currentDateContextText}`
        }]
      : []),
    ...(workspaceContextText
      ? [{
          role: 'user',
          content: `Current session workspace snapshot:\n${workspaceContextText}`
        }]
      : []),
    ...(attachmentContextText
      ? [{
          role: 'user',
          content: `Ephemeral uploaded file context:\n${attachmentContextText}`
        }]
      : []),
    ...conversationHistory,
    ...toolMessages,
    {
      role: 'user',
      content: [
        `Latest user message: ${latestGoal}`,
        'It may be a normal conversation or a concrete task.',
        'Decide the next best action now.'
      ].join('\n')
    }
  ]
}

function buildForcedFinalMessages({
  latestGoal,
  conversationHistory,
  fileChangesRequired = false,
  modifiedWorkspace = false,
  toolMessages,
  systemPrompt,
  workspaceContextText = '',
  attachmentContextText = '',
  currentDateContextText = ''
}) {
  const promptSections = [
    'You are a coding agent running inside a server workspace.',
    'The current session workspace is the only source of truth for this task.',
    'The user may be asking for a normal conversational reply or a task result.',
    'Return strict JSON only.',
    'Do not expose hidden chain-of-thought.',
    'Use the same language as the user.',
    'For ordinary conversation, answer naturally and directly instead of refusing unnecessarily.',
    'You must now finish without calling more tools.',
    'Base the answer on the gathered workspace evidence.',
    'If the request never needed workspace tools, answer naturally and directly.',
    'If ephemeral uploaded files were provided, treat them as reference material for the final answer.',
    'When the user asks for the current date, weekday, or time, use the provided current date context directly.',
    'If file changes were verified, mention the verification result clearly.',
    ...(modifiedWorkspace
      ? [
          'Keep the final reply concise.',
          'If files were changed, summarize what changed and which files were affected.',
          'Do not paste full file contents or long code blocks unless the user explicitly asked to see them.'
        ]
      : []),
    ...(fileChangesRequired && !modifiedWorkspace
      ? [
          'The user asked for file changes, but no file was changed.',
          'Explain briefly that the requested file change was not applied and state the blocking reason.',
          'Do not fabricate code changes and do not paste large code blocks.'
        ]
      : []),
    'JSON schema:',
    '{',
    '  "summary": "short public completion update",',
    '  "reply": "the final user-facing answer"',
    '}'
  ]

  if (systemPrompt) {
    promptSections.push(`Additional behavior preference: ${systemPrompt}`)
  }

  return [
    {
      role: 'system',
      content: promptSections.join('\n')
    },
    ...(currentDateContextText
      ? [{
          role: 'user',
          content: `Current date context:\n${currentDateContextText}`
        }]
      : []),
    ...(workspaceContextText
      ? [{
          role: 'user',
          content: `Current session workspace snapshot:\n${workspaceContextText}`
        }]
      : []),
    ...(attachmentContextText
      ? [{
          role: 'user',
          content: `Ephemeral uploaded file context:\n${attachmentContextText}`
        }]
      : []),
    ...conversationHistory,
    ...toolMessages,
    {
      role: 'user',
      content: [
        `Latest user message: ${latestGoal}`,
        'Produce the best final user-facing reply now.'
      ].join('\n')
    }
  ]
}

function normalizeToolRequest(rawTool) {
  const name = normalizeTrimmedString(rawTool?.name)
  const args =
    rawTool?.args && typeof rawTool.args === 'object' && !Array.isArray(rawTool.args)
      ? rawTool.args
      : {}

  if (!name) {
    throw new Error('Model requested a tool call without a valid tool name.')
  }

  return { name, args }
}

function createToolTranscriptMessages(toolExecution) {
  return [
    {
      role: 'assistant',
      content: `Tool call:\n${serializeJson({
        name: toolExecution.tool,
        args: toolExecution.args
      })}`
    },
    {
      role: 'user',
      content: `Tool result:\n${serializeJson({
        summary: toolExecution.summary,
        result: toolExecution.result
      })}`
    }
  ]
}

function createToolStepTitle(toolName, args) {
  if (toolName === 'read_file') {
    return `读取文件 ${truncateText(args?.path || '', 36) || ''}`.trim()
  }

  if (toolName === 'search_text') {
    return `搜索 ${truncateText(args?.query || '', 28) || '关键字'}`
  }

  if (toolName === 'run_command') {
    const commandLine = [args?.command, ...(Array.isArray(args?.args) ? args.args : [])]
      .filter(Boolean)
      .join(' ')
    return `执行命令 ${truncateText(commandLine, 36) || ''}`.trim()
  }

  if (toolName === 'list_files') {
    return `查看目录 ${truncateText(args?.path || '.', 36)}`
  }

  if (toolName === 'write_file') {
    return `写入文件 ${truncateText(args?.path || '', 36) || ''}`.trim()
  }

  if (toolName === 'apply_patch') {
    return `修改文件 ${truncateText(args?.path || '', 36) || ''}`.trim()
  }

  return `执行工具 ${toolName}`
}

function summarizeToolTarget(toolExecution) {
  const toolName = normalizeTrimmedString(toolExecution?.tool)
  const args = toolExecution?.args && typeof toolExecution.args === 'object'
    ? toolExecution.args
    : {}

  if (['read_file', 'write_file', 'apply_patch', 'list_files'].includes(toolName)) {
    const targetPath = normalizeTrimmedString(args?.path || toolExecution?.result?.path)
    return targetPath ? `目标：${targetPath}` : ''
  }

  if (toolName === 'search_text') {
    const query = normalizeTrimmedString(args?.query || args?.pattern)
    return query ? `搜索：${query}` : ''
  }

  if (toolName === 'run_command') {
    const commandLine = [args?.command, ...(Array.isArray(args?.args) ? args.args : [])]
      .map((item) => normalizeTrimmedString(item))
      .filter(Boolean)
      .join(' ')

    return commandLine ? `命令：${commandLine}` : ''
  }

  return ''
}

function formatToolDuration(durationMs) {
  const normalizedDuration = Number(durationMs)

  if (!Number.isFinite(normalizedDuration) || normalizedDuration < 0) {
    return ''
  }

  if (normalizedDuration < 1000) {
    return `${Math.round(normalizedDuration)}ms`
  }

  return `${(normalizedDuration / 1000).toFixed(normalizedDuration >= 10000 ? 0 : 1)}s`
}

function createNormalizedToolMessageContent(toolExecution) {
  const toolName = normalizeTrimmedString(toolExecution?.tool) || 'unknown_tool'
  const toolSummary = normalizeTrimmedString(toolExecution?.summary) || `${toolName} 已执行。`
  const toolTarget = summarizeToolTarget(toolExecution)
  const toolStatus = normalizeTrimmedString(toolExecution?.status) || 'success'
  const durationLabel = formatToolDuration(toolExecution?.durationMs)

  return [
    `工具：${toolName}`,
    `状态：${toolStatus === 'failed' ? '失败' : '成功'}`,
    durationLabel ? `耗时：${durationLabel}` : '',
    toolTarget,
    `结果：${toolSummary}`
  ].filter(Boolean).join('\n')
}

function createRunningToolMessageContent(toolRequest, liveOutput = '') {
  const toolName = normalizeTrimmedString(toolRequest?.name) || 'unknown_tool'
  const toolTarget = summarizeToolTarget({
    tool: toolName,
    args: toolRequest?.args && typeof toolRequest.args === 'object' ? toolRequest.args : {}
  })
  const normalizedLiveOutput = normalizeTrimmedString(liveOutput)

  return [
    `工具：${toolName}`,
    '状态：running',
    toolTarget,
    `结果：${normalizedLiveOutput || `正在执行 ${toolName}。`}`
  ].filter(Boolean).join('\n')
}

function buildRunCommandLiveOutput(progress = {}) {
  const stdout = normalizeTrimmedString(progress?.stdout)
  const stderr = normalizeTrimmedString(progress?.stderr)
  const output = stdout || stderr

  if (!output) {
    return ''
  }

  const suffixParts = []

  if (progress?.stdoutTruncated) {
    suffixParts.push('stdout 已截断')
  }

  if (progress?.stderrTruncated) {
    suffixParts.push('stderr 已截断')
  }

  const truncatedOutput = truncateText(output, 800)
  const suffix = suffixParts.length ? `\n[${suffixParts.join('，')}]` : ''

  return `${truncatedOutput}${suffix}`.trim()
}

function createToolMessageContent(toolExecution) {
  const toolName = normalizeTrimmedString(toolExecution?.tool) || 'unknown_tool'
  const toolSummary = normalizeTrimmedString(toolExecution?.summary) || `${toolName} 已执行。`
  const toolTarget = summarizeToolTarget(toolExecution)
  const toolStatus = normalizeTrimmedString(toolExecution?.status).toLowerCase() || 'success'
  const durationLabel = formatToolDuration(toolExecution?.durationMs)

  return [
    `工具：${toolName}`,
    `状态：${toolStatus === 'failed' ? '失败' : '成功'}`,
    durationLabel ? `耗时：${durationLabel}` : '',
    toolTarget,
    `结果：${toolSummary}`
  ].filter(Boolean).join('\n')
}

function createSkillMessageContent(skills = []) {
  const normalizedSkills = (Array.isArray(skills) ? skills : [])
    .filter(Boolean)

  if (!normalizedSkills.length) {
    return ''
  }

  const skillNames = normalizedSkills
    .map((item) => normalizeTrimmedString(item.name) || normalizeTrimmedString(item.skillId))
    .filter(Boolean)

  const skillIds = normalizedSkills
    .map((item) => normalizeTrimmedString(item.skillId))
    .filter(Boolean)

  return [
    `技能：${skillNames.join(' + ')}`,
    '状态：已启用',
    skillIds.length ? `目标：${skillIds.join(', ')}` : '',
    `结果：本轮已启用技能：${skillNames.join('、')}。`
  ].filter(Boolean).join('\n')
}

function completeStep(step, summary) {
  const timestamp = nowIso()

  return {
    ...step,
    status: 'completed',
    summary: normalizeTrimmedString(summary) || step.summary,
    completedAt: step.completedAt || timestamp,
    updatedAt: timestamp
  }
}

function cancelStep(step, summary) {
  const timestamp = nowIso()

  return {
    ...step,
    status: 'cancelled',
    summary: normalizeTrimmedString(summary) || step.summary,
    completedAt: timestamp,
    updatedAt: timestamp
  }
}

function failStep(step, summary) {
  const timestamp = nowIso()

  return {
    ...step,
    status: 'failed',
    summary: normalizeTrimmedString(summary) || step.summary,
    completedAt: timestamp,
    updatedAt: timestamp
  }
}

function createFinalReplyStep(summary) {
  const timestamp = nowIso()

  return createTaskStep({
    title: '整理最终答复',
    status: 'completed',
    summary,
    startedAt: timestamp,
    completedAt: timestamp
  })
}

function finalizeRunningSteps(steps, summary) {
  return steps.map((step) => (
    isRunningTaskStatus(step?.status)
      ? completeStep(step, summary)
      : step
  ))
}

function cancelRunningSteps(steps, summary) {
  return steps.map((step) => (
    isRunningTaskStatus(step?.status)
      ? cancelStep(step, summary)
      : step
  ))
}

function isWriteToolName(toolName) {
  return WRITE_TOOL_NAMES.has(String(toolName || '').trim().toLowerCase())
}

function normalizeCommandSpec(item) {
  const command = normalizeTrimmedString(item?.command)
  const args = Array.isArray(item?.args)
    ? item.args.map((arg) => String(arg ?? '')).filter(Boolean)
    : []
  const cwd = normalizeTrimmedString(item?.cwd) || '.'

  if (!command) {
    return null
  }

  return {
    command,
    args,
    cwd
  }
}

function isPlaceholderTestScript(value) {
  const normalized = normalizeTrimmedString(value).toLowerCase()

  return (
    !normalized
    || normalized.includes('no test specified')
    || normalized === 'exit 0'
  )
}

async function resolveVerificationCommands({
  workspaceConfig,
  sessionId,
  toolRunner
} = {}) {
  if (!workspaceConfig?.autoVerifyAfterWrite) {
    return []
  }

  const explicitCommands = Array.isArray(workspaceConfig.autoVerifyCommands)
    ? workspaceConfig.autoVerifyCommands.map((item) => normalizeCommandSpec(item)).filter(Boolean)
    : []

  if (explicitCommands.length) {
    return explicitCommands
  }

  if (!workspaceConfig.allowedCommands.includes('npm')) {
    return []
  }

  try {
    const packageJsonTarget = toolRunner.resolveWorkspace(sessionId).resolvePath('package.json')
    const packageJson = JSON.parse(await readFile(packageJsonTarget.absolutePath, 'utf8'))
    const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object'
      ? packageJson.scripts
      : {}
    const commands = []

    if (normalizeTrimmedString(scripts.build)) {
      commands.push({ command: 'npm', args: ['run', 'build'], cwd: '.' })
    }

    if (normalizeTrimmedString(scripts.test) && !isPlaceholderTestScript(scripts.test)) {
      commands.push({ command: 'npm', args: ['test'], cwd: '.' })
    } else if (!commands.length && normalizeTrimmedString(scripts.lint)) {
      commands.push({ command: 'npm', args: ['run', 'lint'], cwd: '.' })
    }

    return commands
  } catch {
    return []
  }
}

function commandResultMatchesSpec(result, spec) {
  return (
    String(result?.command || '') === String(spec?.command || '')
    && String(result?.cwd || '.') === String(spec?.cwd || '.')
    && JSON.stringify(Array.isArray(result?.args) ? result.args : []) === JSON.stringify(Array.isArray(spec?.args) ? spec.args : [])
  )
}

function buildVerificationSummary(commandSpec) {
  const commandLine = [commandSpec.command, ...(commandSpec.args || [])].join(' ')
  return `正在验证刚才的文件修改：${commandLine}`
}

function createCancellationError(message = '已停止当前处理。') {
  const error = new Error(message)
  error.code = TASK_CANCELLED_CODE
  return error
}

function isCancellationError(error) {
  return error?.code === TASK_CANCELLED_CODE
}

function summarizeChangedFiles(filePaths = []) {
  const normalizedPaths = [...new Set(
    (Array.isArray(filePaths) ? filePaths : [])
      .map((item) => normalizeTrimmedString(item))
      .filter(Boolean)
  )]

  if (!normalizedPaths.length) {
    return ''
  }

  const visiblePaths = normalizedPaths.slice(0, 5)
  const suffix = normalizedPaths.length > visiblePaths.length
    ? ` 等 ${normalizedPaths.length} 个文件`
    : ''

  return visiblePaths.join('、') + suffix
}

function buildWorkspaceCompletionReply({
  changedFiles = [],
  verifiedAfterModification = false
} = {}) {
  const fileSummary = summarizeChangedFiles(changedFiles)

  if (fileSummary && verifiedAfterModification) {
    return `已完成文件处理，并已完成验证。涉及文件：${fileSummary}。请在右侧会话文件中查看。`
  }

  if (fileSummary) {
    return `已完成文件处理。涉及文件：${fileSummary}。请在右侧会话文件中查看。`
  }

  if (verifiedAfterModification) {
    return '已完成文件处理，并已完成验证。请在右侧会话文件中查看。'
  }

  return '已完成文件处理。请在右侧会话文件中查看。'
}

export function createAgentRunner({
  sessionRepository,
  aiRuntimeConfig,
  getAiConfigById,
  resolveModel,
  loadAiConfigs,
  publishSessionEvent,
  skillRegistry,
  sessionWorkspaces,
  runtimeConfig,
  workspaceConfig,
  toolRunner
} = {}) {
  const activeRuns = new Map()

  function pushSessionEvent(sessionId, type, payload = {}) {
    if (typeof publishSessionEvent !== 'function') {
      return
    }

    publishSessionEvent(sessionId, {
      type,
      ...payload
    })
  }

  function publishTaskProgress(sessionId, summary, model = '') {
    const normalizedSummary = normalizeTrimmedString(summary)

    if (!normalizedSummary) {
      return
    }

    pushSessionEvent(sessionId, 'task.progress', {
      summary: normalizedSummary,
      model
    })
  }

  async function appendAssistantReplyWithStreaming(sessionId, {
    content,
    model = '',
    usage
  } = {}) {
    const normalizedContent = normalizeTrimmedString(content)

    if (!normalizedContent) {
      return null
    }

    const chunks = []

    for (let index = 0; index < normalizedContent.length; index += 24) {
      chunks.push(normalizedContent.slice(index, index + 24))
    }

    let partialContent = ''

    for (const chunk of chunks) {
      partialContent += chunk
      pushSessionEvent(sessionId, 'assistant.partial', {
        content: partialContent,
        model
      })

      if (chunks.length > 1) {
        await sleep(18)
      }
    }

    const message = await sessionRepository.appendAssistantMessage(sessionId, {
      content: normalizedContent,
      model,
      usage
    })

    pushSessionEvent(sessionId, 'assistant.finalized', {
      model
    })

    return message
  }

  async function appendFailureAssistantMessage(sessionId, summary, model = '') {
    const normalizedSummary = normalizeTrimmedString(summary) || '\u4efb\u52a1\u6267\u884c\u5931\u8d25\u3002'
  
    return appendAssistantReplyWithStreaming(sessionId, {
      content: `\u5904\u7406\u5931\u8d25\uff1a${normalizedSummary}`,
      model
    })
  }

  async function markTaskCancelled(sessionId, summary = '已停止当前处理。') {
    return sessionRepository.updateSession(sessionId, (draftSession) => {
      if (!draftSession?.task) {
        return draftSession
      }

      draftSession.task = {
        ...draftSession.task,
        status: 'cancelled',
        summary,
        steps: cancelRunningSteps(
          Array.isArray(draftSession.task.steps) ? draftSession.task.steps : [],
          summary
        ),
        completedAt: draftSession.task.completedAt || nowIso(),
        updatedAt: nowIso()
      }
      draftSession.updatedAt = nowIso()

      return draftSession
    })
  }

  async function runTask({
    sessionId,
    requestedAiId,
    requestedModel,
    requestedSkillId,
    requestedSkillIds = [],
    requestedAttachments = [],
    abortSignal
  }) {
    const taskStartedAtMs = Date.now()
    const throwIfCancelled = () => {
      if (abortSignal?.aborted) {
        throw createCancellationError()
      }
    }
    const throwIfTaskTimedOut = () => {
      const timeoutMs = Number(runtimeConfig?.taskTimeoutMs || 0)

      if (timeoutMs > 0 && Date.now() - taskStartedAtMs > timeoutMs) {
        throw new Error(`Task exceeded the maximum runtime of ${Math.ceil(timeoutMs / 1000)} seconds.`)
      }
    }

    const session = await sessionRepository.getSession(sessionId)

    if (!session) {
      return
    }

    throwIfCancelled()
    throwIfTaskTimedOut()

    const latestUserMessage = [...(session.messages || [])]
      .reverse()
      .find((item) => item.role === 'user')

    if (!latestUserMessage?.content) {
      const failureSummary = '\u672a\u627e\u5230\u53ef\u6267\u884c\u7684\u7528\u6237\u76ee\u6807\u3002'

      await sessionRepository.updateSession(sessionId, (draftSession) => {
        draftSession.task = {
          ...draftSession.task,
          taskId: draftSession.task?.taskId || createId('task'),
          status: 'failed',
          summary: '未找到可执行的用户目标。',
          completedAt: nowIso(),
          updatedAt: nowIso()
        }

        return draftSession
      })
      await appendFailureAssistantMessage(sessionId, failureSummary)
      return
    }

    const aiConfig = await getAiConfigById(aiRuntimeConfig, requestedAiId)
    const activeSkills = (
      Array.isArray(requestedSkillIds) && requestedSkillIds.length
        ? requestedSkillIds.map((skillId) => skillRegistry?.getSkillById(skillId)).filter(Boolean)
        : [skillRegistry?.resolveSkill(requestedSkillId)].filter(Boolean)
    )
    const activeSkill = mergeActiveSkills(activeSkills)
    const activeSkillPrompt = buildActiveSkillPrompt(activeSkills)

    if (!aiConfig || !aiConfig.apiKey) {
      const failureSummary = '\u5f53\u524d\u6ca1\u6709\u53ef\u7528\u7684 AI \u914d\u7f6e\uff0c\u8bf7\u5148\u68c0\u67e5 AI \u914d\u7f6e\u548c API Key\u3002'

      await sessionRepository.updateSession(sessionId, (draftSession) => {
        draftSession.task = {
          ...draftSession.task,
          taskId: draftSession.task?.taskId || createId('task'),
          status: 'failed',
          summary: '当前没有可用的 AI 配置，请先检查 AI 配置和 API Key。',
          completedAt: nowIso(),
          updatedAt: nowIso()
        }

        return draftSession
      })
      await appendFailureAssistantMessage(sessionId, failureSummary)
      return
    }

    const selectedModel = resolveModel(aiConfig, requestedModel)
    const taskId = session.task?.taskId || createId('task')
    const conversationHistory = toChatHistorySafe(
      getRecentMessages(session.messages || [], aiRuntimeConfig.recentMessages)
    )
    const latestGoal = String(latestUserMessage.content)
    const fileChangesRequired = looksLikeFileChangeRequestSafe(latestGoal)
    const requiredCompanionExtensions = getRequiredCompanionExtensionsSafe(latestGoal)
    const currentDateContextText = buildCurrentDateContext(runtimeConfig?.timezone)
    const attachmentContextText = buildAttachmentContextText(requestedAttachments)
    const toolMessages = []
    const verificationCommands = await resolveVerificationCommands({
      workspaceConfig,
      sessionId,
      toolRunner
    })
    throwIfCancelled()
    const executionState = {
      modifiedWorkspace: false,
      changedFiles: [],
      verifiedAfterModification: false,
      autoVerificationAttempted: false
    }
    const analysisStep = createTaskStep({
      title: '理解目标',
      status: 'in_progress',
      summary: '正在分析需求并决定下一步行动。',
      startedAt: nowIso()
    })
    const taskSteps = [analysisStep]
    publishTaskProgress(sessionId, '正在分析你的目标并准备下一步。', selectedModel)

    await sessionRepository.updateSession(sessionId, (draftSession) => {
      draftSession.lastAiId = aiConfig.aiId
      draftSession.lastModel = selectedModel
      draftSession.updatedAt = nowIso()
      draftSession.task = {
        ...draftSession.task,
        taskId,
        title: draftSession.title,
        status: 'running',
        summary: analysisStep.summary,
        steps: taskSteps,
        startedAt: draftSession.task?.startedAt || nowIso(),
        completedAt: null,
        updatedAt: nowIso()
      }

      return draftSession
    })

    const skillMessageContent = createSkillMessageContent(activeSkills)

    if (skillMessageContent) {
      await sessionRepository.appendToolMessage(sessionId, {
        content: skillMessageContent
      })
    }

    async function executeToolRequest(toolRequest, {
      summary = '',
      stepTitle = ''
    } = {}) {
      throwIfCancelled()
      throwIfTaskTimedOut()

      const normalizedRequest = normalizeToolRequest(toolRequest)
      const toolExecutionId = createId('tool')
      publishTaskProgress(
        sessionId,
        summary || `正在执行工具 ${normalizedRequest.name}。`,
        selectedModel
      )
      pushSessionEvent(sessionId, 'tool.started', {
        executionId: toolExecutionId,
        content: createRunningToolMessageContent(normalizedRequest)
      })

      const toolStep = createTaskStep({
        title: stepTitle || createToolStepTitle(normalizedRequest.name, normalizedRequest.args),
        status: 'in_progress',
        summary: summary || `正在执行工具 ${normalizedRequest.name}。`,
        startedAt: nowIso()
      })
      taskSteps.push(toolStep)

      await sessionRepository.updateSession(sessionId, (draftSession) => {
        draftSession.task = {
          ...draftSession.task,
          taskId,
          status: 'running',
          summary: toolStep.summary,
          steps: taskSteps,
          updatedAt: nowIso()
        }

        return draftSession
      })

      let toolExecution
      const toolStartedAt = Date.now()

      try {
        toolExecution = await toolRunner.executeToolCall(normalizedRequest, {
          skill: activeSkill,
          signal: abortSignal,
          sessionId,
          onProgress: (progress) => {
            if (normalizedRequest.name !== 'run_command') {
              return
            }

            const liveOutput = buildRunCommandLiveOutput(progress)

            if (!liveOutput) {
              return
            }

            pushSessionEvent(sessionId, 'tool.output', {
              executionId: toolExecutionId,
              content: createRunningToolMessageContent(normalizedRequest, liveOutput)
            })
          }
        })
        toolExecution = {
          ...toolExecution,
          status: 'success',
          durationMs: Date.now() - toolStartedAt
        }
      } catch (error) {
        if (isCancellationError(error) || abortSignal?.aborted) {
          taskSteps[taskSteps.length - 1] = cancelStep(toolStep, '已停止当前处理。')
          throw createCancellationError()
        }
        const errorMessage = normalizeTrimmedString(error?.message) || `工具 ${normalizedRequest.name} 执行失败。`
        taskSteps[taskSteps.length - 1] = failStep(toolStep, errorMessage)

        await sessionRepository.appendToolMessage(sessionId, {
          content: [
            `Tool: ${normalizedRequest.name}`,
            '状态：失败',
            '',
            errorMessage
          ].join('\n')
        })

        pushSessionEvent(sessionId, 'tool.finished', {
          executionId: toolExecutionId,
          status: 'failed'
        })

        await sessionRepository.updateSession(sessionId, (draftSession) => {
          draftSession.task = {
            ...draftSession.task,
            taskId,
            status: 'failed',
            summary: errorMessage,
            steps: taskSteps,
            completedAt: nowIso(),
            updatedAt: nowIso()
          }

          return draftSession
        })

        await appendFailureAssistantMessage(sessionId, errorMessage, selectedModel)

        return {
          ok: false,
          failed: true
        }
      }

      throwIfCancelled()
      throwIfTaskTimedOut()
      taskSteps[taskSteps.length - 1] = completeStep(toolStep, toolExecution.summary)
      toolMessages.push(...createToolTranscriptMessages(toolExecution))
      publishTaskProgress(sessionId, toolExecution.summary, selectedModel)

      await sessionRepository.appendToolMessage(sessionId, {
        content: createNormalizedToolMessageContent(toolExecution)
      })

      pushSessionEvent(sessionId, 'tool.finished', {
        executionId: toolExecutionId,
        status: 'success'
      })

      if (isWriteToolName(toolExecution.tool) && toolExecution.result?.changed !== false) {
        executionState.modifiedWorkspace = true
        executionState.verifiedAfterModification = false

        const writtenPath = normalizeTrimmedString(toolExecution.result?.path)

        if (writtenPath) {
          executionState.changedFiles.push(writtenPath)
        }

        if (sessionWorkspaces && writtenPath) {
          try {
            const capturedFile = sessionWorkspaces.createWorkspaceFileRecord(sessionId, writtenPath, {
              sizeBytes: toolExecution.result?.sizeBytes ?? null,
              updatedAt: nowIso()
            })
            await sessionRepository.upsertWorkspaceFile(sessionId, capturedFile)
          } catch (error) {
            console.warn(
              '[agent-runner] failed to record session workspace file:',
              error instanceof Error ? error.message : error
            )
          }
        }
      }

      if (
        toolExecution.tool === 'run_command'
        && executionState.modifiedWorkspace
        && toolExecution.result?.exitCode === 0
      ) {
        if (!verificationCommands.length) {
          executionState.verifiedAfterModification = true
        } else if (verificationCommands.some((spec) => commandResultMatchesSpec(toolExecution.result, spec))) {
          executionState.verifiedAfterModification = true
        }
      }

      await sessionRepository.updateSession(sessionId, (draftSession) => {
        draftSession.task = {
          ...draftSession.task,
          taskId,
          status: 'running',
          summary: toolExecution.summary,
          steps: taskSteps,
          updatedAt: nowIso()
        }

        return draftSession
      })

      return {
        ok: true,
        toolExecution
      }
    }

    async function maybeRunAutoVerification() {
      throwIfCancelled()
      throwIfTaskTimedOut()

      if (
        !executionState.modifiedWorkspace
        || executionState.verifiedAfterModification
        || executionState.autoVerificationAttempted
      ) {
        return {
          ranVerification: false,
          failedTask: false
        }
      }

      executionState.autoVerificationAttempted = true

      if (!verificationCommands.length) {
        return {
          ranVerification: false,
          failedTask: false
        }
      }

      publishTaskProgress(sessionId, '正在验证刚刚完成的文件修改。', selectedModel)

      for (const commandSpec of verificationCommands) {
        throwIfCancelled()

        const result = await executeToolRequest({
          name: 'run_command',
          args: {
            command: commandSpec.command,
            args: commandSpec.args,
            cwd: commandSpec.cwd
          }
        }, {
          summary: buildVerificationSummary(commandSpec),
          stepTitle: `验证修改 ${truncateText([commandSpec.command, ...(commandSpec.args || [])].join(' '), 36)}`
        })

        if (!result.ok) {
          return {
            ranVerification: true,
            failedTask: true
          }
        }

        if (result.toolExecution.result?.exitCode !== 0) {
          executionState.verifiedAfterModification = false
          return {
            ranVerification: true,
            failedTask: false
          }
        }
      }

      executionState.verifiedAfterModification = true

      return {
        ranVerification: true,
        failedTask: false
      }
    }

    async function maybePersistReplyAsWorkspaceFile(reply) {
      if (executionState.modifiedWorkspace) {
        return false
      }

      const extracted = extractWritableContentFromReply(reply)
      const targetPath = inferFilePathFromReply(latestGoal, extracted.content || reply)
      const fileContent = String(extracted.content || '').trim()

      if (!targetPath || !fileContent) {
        return false
      }

      const result = await executeToolRequest({
        name: 'write_file',
        args: {
          path: targetPath,
          content: fileContent,
          createDirectories: true
        }
      }, {
        summary: `正在将生成内容写入 ${targetPath}。`,
        stepTitle: `写入文件 ${truncateText(targetPath, 36)}`
      })

      return result.ok
    }

    await sleep(runtimeConfig.stepDelayMs)
    throwIfCancelled()
    throwIfTaskTimedOut()

    try {
      for (let iteration = 0; iteration < runtimeConfig.maxToolIterations; iteration += 1) {
        throwIfCancelled()
        throwIfTaskTimedOut()
        const workspaceContextText = await buildWorkspaceSnapshotText({
          sessionId,
          latestGoal,
          changedFiles: executionState.changedFiles,
          sessionRepository,
          sessionWorkspaces
        })

        const decision = await createStructuredCompletion({
          aiConfig,
          model: selectedModel,
          requestTimeoutMs: aiRuntimeConfig.requestTimeoutMs,
          idleTimeoutMs: aiRuntimeConfig.idleTimeoutMs,
          streamResponses: aiRuntimeConfig.streamResponses,
          timeoutRetries: aiRuntimeConfig.timeoutRetries,
          timeoutRetryDelayMs: aiRuntimeConfig.timeoutRetryDelayMs,
          signal: abortSignal,
          messages: buildAgentLoopMessages({
            latestGoal,
            conversationHistory,
            requireFileChanges: fileChangesRequired,
            toolMessages,
          toolPromptText: toolRunner.getPromptText({ skill: activeSkill }),
          systemPrompt: [aiConfig.systemPrompt, activeSkillPrompt].filter(Boolean).join('\n\n'),
          remainingIterations: runtimeConfig.maxToolIterations - iteration,
          workspaceContextText,
          attachmentContextText,
          currentDateContextText
        })
        })
        throwIfCancelled()
        throwIfTaskTimedOut()

        const action = normalizeAction(decision.json?.action)
        const decisionSummary = normalizeTrimmedString(decision.json?.summary)

        if (action === 'tool') {
          taskSteps[0] = completeStep(
            taskSteps[0],
            decisionSummary || '已分析目标，开始检查工作区。'
          )

          const result = await executeToolRequest(decision.json?.tool, {
            summary: decisionSummary || `正在执行工具 ${normalizeTrimmedString(decision.json?.tool?.name) || ''}。`
          })

          if (!result.ok) {
            return
          }

          await sleep(runtimeConfig.stepDelayMs)
          continue
        }

        if (action === 'ask_user') {
          const reply = normalizeTrimmedString(decision.json?.reply) || '我还缺少一项关键信息，你可以再补充一点吗？'
          const waitingSummary = decisionSummary || '当前目标还需要补充信息。'
          const finalizedSteps = finalizeRunningSteps(taskSteps, waitingSummary)

          await sessionRepository.updateSession(sessionId, (draftSession) => {
            draftSession.task = {
              ...draftSession.task,
              taskId,
              status: 'waiting_for_user',
              summary: waitingSummary,
              steps: finalizedSteps,
              completedAt: nowIso(),
              updatedAt: nowIso()
            }

            return draftSession
          })

          publishTaskProgress(sessionId, waitingSummary, selectedModel)

          await appendAssistantReplyWithStreaming(sessionId, {
            content: reply,
            model: selectedModel,
            usage: decision.usage
          })
          return
        }

        const autoVerification = await maybeRunAutoVerification()

        if (autoVerification.failedTask) {
          return
        }

        if (autoVerification.ranVerification) {
          await sleep(runtimeConfig.stepDelayMs)
          continue
        }

        if (fileChangesRequired && !executionState.modifiedWorkspace) {
          toolMessages.push({
            role: 'user',
            content: [
              'The user asked for real file changes.',
              'No file has been changed yet.',
              'Call a workspace tool to create, modify, or delete files, or ask one brief clarification question if required information is missing.',
              'Do not finish with a reply-only answer yet.'
            ].join('\n')
          })

          await sleep(runtimeConfig.stepDelayMs)
          continue
        }

        if (
          executionState.modifiedWorkspace
          && requiredCompanionExtensions.length
          && !hasRequiredCompanionChanges(requiredCompanionExtensions, executionState.changedFiles)
        ) {
          toolMessages.push({
            role: 'user',
            content: [
              `The task explicitly requires companion files: ${requiredCompanionExtensions.join(', ')}.`,
              'Those companion files have not been created or updated yet.',
              'Do not finish yet. Continue modifying the existing files in the current session workspace and create or update the missing companion file.'
            ].join('\n')
          })

          await sleep(runtimeConfig.stepDelayMs)
          continue
        }

        const finalReply = normalizeTrimmedString(decision.json?.reply)

        if (
          fileChangesRequired
          && !executionState.modifiedWorkspace
          && finalReply
          && looksLikeCodeHeavyContent(finalReply)
        ) {
          const persisted = await maybePersistReplyAsWorkspaceFile(finalReply)

          if (persisted) {
            await sleep(runtimeConfig.stepDelayMs)
            continue
          }
        }

        if (
          fileChangesRequired
          && !executionState.modifiedWorkspace
          && finalReply
          && (looksLikeCompletedFileChangeClaimSafe(finalReply) || extractExplicitFilePaths(finalReply).length)
        ) {
          toolMessages.push({
            role: 'user',
            content: [
              'The previous final reply claimed that files were created or modified.',
              'However, no workspace write tool has succeeded yet.',
              'Do not claim success until write_file or apply_patch actually succeeds.',
              'Continue editing the existing workspace files now.'
            ].join('\n')
          })

          await sleep(runtimeConfig.stepDelayMs)
          continue
        }

        if (!finalReply && !executionState.modifiedWorkspace) {
          throw new Error('Model returned a final action without a reply.')
        }

        const completionSummary = decisionSummary || '任务已完成。'
        const finalizedSteps = finalizeRunningSteps(taskSteps, completionSummary)
        finalizedSteps.push(createFinalReplyStep(completionSummary))

        await sessionRepository.updateSession(sessionId, (draftSession) => {
          draftSession.task = {
            ...draftSession.task,
            taskId,
            status: 'completed',
            summary: completionSummary,
            steps: finalizedSteps,
            completedAt: nowIso(),
            updatedAt: nowIso()
          }

          return draftSession
        })

        const userFacingReply = buildSafeAssistantReply({
          reply: finalReply,
          fileChangesRequired,
          modifiedWorkspace: executionState.modifiedWorkspace,
          changedFiles: executionState.changedFiles,
          verifiedAfterModification: executionState.verifiedAfterModification
        })

        publishTaskProgress(sessionId, '正在整理最终回复。', selectedModel)

        await appendAssistantReplyWithStreaming(sessionId, {
          content: userFacingReply,
          model: selectedModel,
          usage: decision.usage
        })
        return
      }

      const autoVerification = await maybeRunAutoVerification()

      if (autoVerification.failedTask) {
        return
      }

      const workspaceContextText = await buildWorkspaceSnapshotText({
        sessionId,
        latestGoal,
        changedFiles: executionState.changedFiles,
        sessionRepository,
        sessionWorkspaces
      })

      const forcedFinal = await createStructuredCompletion({
        aiConfig,
        model: selectedModel,
        requestTimeoutMs: aiRuntimeConfig.requestTimeoutMs,
        idleTimeoutMs: aiRuntimeConfig.idleTimeoutMs,
        streamResponses: aiRuntimeConfig.streamResponses,
        timeoutRetries: aiRuntimeConfig.timeoutRetries,
        timeoutRetryDelayMs: aiRuntimeConfig.timeoutRetryDelayMs,
        signal: abortSignal,
        messages: buildForcedFinalMessages({
          latestGoal,
          conversationHistory,
          fileChangesRequired,
          modifiedWorkspace: executionState.modifiedWorkspace,
              toolMessages,
              systemPrompt: [aiConfig.systemPrompt, activeSkillPrompt].filter(Boolean).join('\n\n'),
              workspaceContextText,
              attachmentContextText,
              currentDateContextText
            })
          })
      const finalReply = normalizeTrimmedString(forcedFinal.json?.reply)

      if (
        fileChangesRequired
        && !executionState.modifiedWorkspace
        && finalReply
        && looksLikeCodeHeavyContent(finalReply)
      ) {
        const persisted = await maybePersistReplyAsWorkspaceFile(finalReply)

        if (persisted) {
          const refreshedWorkspaceContextText = await buildWorkspaceSnapshotText({
            sessionId,
            latestGoal,
            changedFiles: executionState.changedFiles,
            sessionRepository,
            sessionWorkspaces
          })
          const recoveryFinal = await createStructuredCompletion({
            aiConfig,
            model: selectedModel,
            requestTimeoutMs: aiRuntimeConfig.requestTimeoutMs,
            idleTimeoutMs: aiRuntimeConfig.idleTimeoutMs,
            streamResponses: aiRuntimeConfig.streamResponses,
            timeoutRetries: aiRuntimeConfig.timeoutRetries,
            timeoutRetryDelayMs: aiRuntimeConfig.timeoutRetryDelayMs,
            signal: abortSignal,
            messages: buildForcedFinalMessages({
              latestGoal,
              conversationHistory,
              fileChangesRequired,
              modifiedWorkspace: executionState.modifiedWorkspace,
              toolMessages,
              systemPrompt: [aiConfig.systemPrompt, activeSkillPrompt].filter(Boolean).join('\n\n'),
              workspaceContextText: refreshedWorkspaceContextText,
              attachmentContextText,
              currentDateContextText
            })
          })

          const recoveredReply = normalizeTrimmedString(recoveryFinal.json?.reply)
          const recoveredSummary = normalizeTrimmedString(recoveryFinal.json?.summary) || '已基于最新工作区结果完成答复。'
          const refreshedSteps = finalizeRunningSteps(taskSteps, recoveredSummary)
          refreshedSteps.push(createFinalReplyStep(recoveredSummary))

          await sessionRepository.updateSession(sessionId, (draftSession) => {
            draftSession.task = {
              ...draftSession.task,
              taskId,
              status: 'completed',
              summary: recoveredSummary,
              steps: refreshedSteps,
              completedAt: nowIso(),
              updatedAt: nowIso()
            }

            return draftSession
          })

          const recoveredUserFacingReply = buildSafeAssistantReply({
            reply: recoveredReply,
            fileChangesRequired,
            modifiedWorkspace: executionState.modifiedWorkspace,
            changedFiles: executionState.changedFiles,
            verifiedAfterModification: executionState.verifiedAfterModification
          })

          publishTaskProgress(sessionId, '正在整理最终回复。', selectedModel)

          await appendAssistantReplyWithStreaming(sessionId, {
            content: recoveredUserFacingReply,
            model: selectedModel,
            usage: recoveryFinal.usage
          })
          return
        }
      }

      if (
        fileChangesRequired
        && !executionState.modifiedWorkspace
        && finalReply
        && (looksLikeCompletedFileChangeClaimSafe(finalReply) || extractExplicitFilePaths(finalReply).length)
      ) {
        throw new Error('The model claimed that file changes were completed, but no workspace write tool actually succeeded.')
      }

      if (!finalReply && !executionState.modifiedWorkspace) {
        throw new Error('Model reached the tool iteration limit without producing a final answer.')
      }

      const completionSummary = normalizeTrimmedString(forcedFinal.json?.summary) || '已基于已收集的信息完成答复。'
      if (
        executionState.modifiedWorkspace
        && requiredCompanionExtensions.length
        && !hasRequiredCompanionChanges(requiredCompanionExtensions, executionState.changedFiles)
      ) {
        throw new Error(`The requested file split is incomplete. Missing companion file update for: ${requiredCompanionExtensions.join(', ')}`)
      }

      const finalizedSteps = finalizeRunningSteps(taskSteps, completionSummary)
      finalizedSteps.push(createFinalReplyStep(completionSummary))

      await sessionRepository.updateSession(sessionId, (draftSession) => {
        draftSession.task = {
          ...draftSession.task,
          taskId,
          status: 'completed',
          summary: completionSummary,
          steps: finalizedSteps,
          completedAt: nowIso(),
          updatedAt: nowIso()
        }

        return draftSession
      })

      const userFacingReply = buildSafeAssistantReply({
        reply: finalReply,
        fileChangesRequired,
        modifiedWorkspace: executionState.modifiedWorkspace,
        changedFiles: executionState.changedFiles,
        verifiedAfterModification: executionState.verifiedAfterModification
      })

      publishTaskProgress(sessionId, '正在整理最终回复。', selectedModel)

      await appendAssistantReplyWithStreaming(sessionId, {
        content: userFacingReply,
        model: selectedModel,
        usage: forcedFinal.usage
      })
    } catch (error) {
      if (isCancellationError(error) || abortSignal?.aborted) {
        const cancelledSummary = '已停止当前处理。'
        const cancelledSteps = cancelRunningSteps(taskSteps, cancelledSummary)

        await sessionRepository.updateSession(sessionId, (draftSession) => {
          draftSession.task = {
            ...draftSession.task,
            taskId,
            status: 'cancelled',
            summary: cancelledSummary,
            steps: cancelledSteps,
            completedAt: nowIso(),
            updatedAt: nowIso()
          }

          return draftSession
        })
        return
      }
      const failureSummary = normalizeTrimmedString(error?.message) || '任务执行失败。'
      const failedSteps = taskSteps.map((step) => (
        isRunningTaskStatus(step?.status)
          ? failStep(step, failureSummary)
          : step
      ))

      await sessionRepository.updateSession(sessionId, (draftSession) => {
        draftSession.task = {
          ...draftSession.task,
          taskId,
          status: 'failed',
          summary: failureSummary,
          steps: failedSteps,
          completedAt: nowIso(),
          updatedAt: nowIso()
        }

        return draftSession
      })
      await appendFailureAssistantMessage(sessionId, failureSummary, selectedModel)
    }
  }

  function startTask(input) {
    const existingRun = activeRuns.get(input.sessionId)

    if (existingRun) {
      return existingRun.promise
    }

    const controller = new AbortController()
    const taskPromise = runTask({
      ...input,
      abortSignal: controller.signal
    })
      .finally(() => {
        activeRuns.delete(input.sessionId)
      })

    activeRuns.set(input.sessionId, {
      promise: taskPromise,
      controller
    })
    return taskPromise
  }

  function isTaskActive(sessionId) {
    return activeRuns.has(sessionId)
  }

  async function cancelTask(sessionId) {
    const session = await sessionRepository.getSession(sessionId)

    if (!session) {
      return null
    }

    const activeRun = activeRuns.get(sessionId)

    if (activeRun) {
      activeRun.controller.abort()
    }

    if (activeRun || isRunningTaskStatus(session?.task?.status)) {
      return markTaskCancelled(sessionId)
    }

    return session
  }

  function getAvailableConfigs() {
    return loadAiConfigs(aiRuntimeConfig)
  }

  return {
    cancelTask,
    startTask,
    isTaskActive,
    getAvailableConfigs
  }
}
