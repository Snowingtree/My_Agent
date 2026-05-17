import { readFile } from 'node:fs/promises'
import { createStructuredCompletion, createTextCompletion } from './llmClient.js'
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
const UI_FILE_CHANGE_REQUEST_PATTERNS = [
  /\u5199\u4ee3\u7801|\u6539\u4ee3\u7801|\u751f\u6210\u4ee3\u7801|\u521b\u5efa\u4ee3\u7801|\u5199\u4e00\u4e2a\u9875\u9762|\u5199\u4e2a\u9875\u9762|\u5199\u4e00\u4e2a\u7f51\u9875|\u5199\u4e2a\u7f51\u9875|\u65b0\u5efa\u9875\u9762|\u521b\u5efa\u9875\u9762|\u505a\u4e00\u4e2a\u9875\u9762|\u505a\u4e2a\u9875\u9762|\u505a\u4e00\u4e2a\u754c\u9762|\u505a\u4e2a\u754c\u9762|\u5199\u4e00\u4e2a\u754c\u9762|\u5199\u4e2a\u754c\u9762|\u521b\u5efa\u754c\u9762|\u751f\u6210\u9875\u9762|\u751f\u6210\u754c\u9762|\u521b\u5efa\u7ec4\u4ef6|\u65b0\u5efa\u7ec4\u4ef6|\u5199\u4e00\u4e2a\u7ec4\u4ef6|\u5199\u4e2a\u7ec4\u4ef6|\u5199\u4e00\u4e2a\u811a\u672c|\u5199\u4e2a\u811a\u672c|\u5199\u4e00\u4e2a html|\u5199\u4e00\u4e2a vue|\u5199\u4e00\u4e2a python|\u5199\u4e00\u4e2a py/i,
  /(?:\u5199|\u521b\u5efa|\u751f\u6210|\u505a|\u5199\u5165)[\s\S]{0,40}(?:\u9875\u9762|\u7f51\u9875|\u754c\u9762|\u4e3b\u9875|\u7ec4\u4ef6|\u811a\u672c|\u6587\u4ef6|html|css|javascript|js|vue|react|python|py|index[\s,，.]*html)/i,
  /\b(create|build|make|generate|write)\b.*\b(page|webpage|ui|interface|html|css|javascript|js|python|py|vue|react|component|script)\b/i,
  /\b(page|ui|interface|html|css|javascript|js|vue|react|component)\b.*\b(create|build|make|generate|write)\b/i
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

const EXPLICIT_FILE_MUTATION_REQUEST_PATTERNS = [
  /(?:\u4fee\u6539|\u6539\u4e00\u4e0b|\u8c03\u6574|\u4f18\u5316|\u4fee\u590d|\u91cd\u65b0|\u91cd\u505a|\u5220\u9664|\u66ff\u6362|\u589e\u52a0|\u6dfb\u52a0|\u66f4\u65b0|\u91cd\u5199|\u5199\u5165|\u4fdd\u5b58|\u521b\u5efa|\u65b0\u5efa|\u751f\u6210)/i,
  /\b(change|edit|modify|adjust|optimize|fix|repair|redo|rework|delete|remove|replace|add|update|rewrite|write|save|create|generate)\b/i
]

const SAFE_FILE_CHANGE_CONFIRMATION_PATTERNS = [
  /\b(created|generated|saved|updated|modified|rewritten|split|extracted|separated|added|imported|linked)\b/i,
  /(?:\u5df2\u7ecf|\u5df2|\u6211\u5df2\u7ecf|\u6211\u5df2|\u6587\u4ef6\u5df2)(?:[^\n\u3002\uff1b]{0,32})?(?:\u521b\u5efa|\u751f\u6210|\u4fdd\u5b58|\u5199\u5165|\u4fee\u6539|\u66f4\u65b0|\u5206\u79bb|\u62c6\u5206|\u62bd\u79bb|\u5b8c\u6210|\u5f15\u5165|\u5f15\u7528|\u5220\u9664|\u6dfb\u52a0)/
]

const READ_ONLY_FILE_INSPECTION_PATTERNS = [
  /(?:\u9605\u8bfb|\u8bfb\u53d6|\u67e5\u770b|\u770b\u4e00\u4e0b|\u5206\u6790|\u89e3\u91ca|\u8bf4\u660e|\u544a\u8bc9\u6211|\u8bb2\u89e3|\u68b3\u7406|\u603b\u7ed3|\u63cf\u8ff0|\u7406\u89e3)[\s\S]{0,80}(?:\u5e03\u5c40|\u7ed3\u6784|\u4ee3\u7801|\u6587\u4ef6|\u9875\u9762|\u7f51\u9875|\u754c\u9762|html|css|javascript|js|vue|react|index[\s,，.]*html)/i,
  /(?:\u5e03\u5c40|\u9875\u9762\u7ed3\u6784|\u4ee3\u7801\u7ed3\u6784|\u6587\u4ef6\u7ed3\u6784|\u600e\u4e48\u5e03\u5c40|\u5982\u4f55\u5e03\u5c40|\u600e\u4e48\u8fdb\u884c\u5e03\u5c40|\u4e3a\u4ec0\u4e48)[\s\S]{0,80}(?:\u5e03\u5c40|\u7ed3\u6784|\u4ee3\u7801|\u6587\u4ef6|\u9875\u9762|\u7f51\u9875|\u754c\u9762|html|css|javascript|js|vue|react|index[\s,，.]*html)?/i,
  /\b(read|review|inspect|analyze|explain|describe|summarize|tell me|walk me through)\b[\s\S]{0,80}\b(file|code|layout|structure|html|css|javascript|js|vue|react|index\.html)\b/i
]

const DESCRIPTIVE_PRIOR_WRITE_PATTERNS = [
  /(?:\u4f60|\u52a9\u624b|agent|Agent|\u4e4b\u524d|\u521a\u624d|\u4e0a\u6b21|\u5df2\u7ecf|\u5df2)(?:[\s\S]{0,10})(?:\u5199|\u521b\u5efa|\u751f\u6210|\u505a|\u4fdd\u5b58)(?:\u7684|\u8fc7|\u51fa\u6765|\u597d)?/gi,
  /\b(?:you|assistant|agent|previously|already|just)\s+(?:wrote|created|generated|built|made|saved)\b/gi
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

function normalizeMemoryMessageCount(value, maxValue) {
  const parsedValue = Number.parseInt(value, 10)
  const safeMaxValue = Math.max(0, Number.parseInt(maxValue, 10) || 0)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0
  }

  return Math.min(parsedValue, safeMaxValue)
}

function serializeMessagesForMemory(messages = [], maxCharsPerMessage = 1200) {
  return messages
    .map((message, index) => {
      const role = normalizeTrimmedString(message?.role) || 'assistant'
      const createdAt = normalizeTrimmedString(message?.createdAt)
      const content = truncateText(String(message?.content || '').replace(/\s+/g, ' '), maxCharsPerMessage)
      return content ? `${index + 1}. ${role}${createdAt ? ` @ ${createdAt}` : ''}: ${content}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function normalizeMemorySummary(value, maxChars = 6000) {
  const normalizedValue = normalizeTrimmedString(value)

  if (!normalizedValue) {
    return ''
  }

  return normalizedValue.length > maxChars ? normalizedValue.slice(0, maxChars).trim() : normalizedValue
}

function looksLikeUserProfileMemoryRequest(value) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return false
  }

  return (
    /记住|记一下|长期记忆|用户画像|我的偏好|我喜欢|我不喜欢|我习惯|以后你|以后都|之后你|默认用|默认不要/.test(normalized)
    || /\b(remember this|remember that|my preference|i prefer|i like|i dislike|from now on|by default)\b/i.test(normalized)
  )
}

function createMemorySummaryMessages({ existingSummary = '', messagesToCompress = [], maxChars = 6000 } = {}) {
  const serializedMessages = serializeMessagesForMemory(messagesToCompress)

  return [
    {
      role: 'system',
      content: [
        'You compress conversation history for a long-running coding agent.',
        'Return strict JSON only.',
        'Do not include hidden reasoning.',
        'Preserve current-session project decisions, selected tools, important constraints, file names, unresolved tasks, and facts needed for future turns in this session.',
        'Stable user preferences belong in the long-term user profile memory, not in this short-term session summary, unless they directly affect the current session.',
        'Remove greetings, repeated status updates, transient tool logs, and low-value chatter.',
        `Keep the summary under ${maxChars} characters.`,
        'JSON schema:',
        '{',
        '  "summary": "compressed long-term conversation memory"',
        '}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        existingSummary ? `Existing memory summary:\n${existingSummary}` : 'Existing memory summary: (empty)',
        '',
        'New messages to merge into memory:',
        serializedMessages || '(empty)'
      ].join('\n')
    }
  ]
}

function removeDescriptivePriorWritePhrases(value) {
  return DESCRIPTIVE_PRIOR_WRITE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, ''),
    String(value || '')
  )
}

function looksLikeReadOnlyFileInspectionRequest(value) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return false
  }

  const withoutDescriptivePriorWrite = removeDescriptivePriorWritePhrases(normalized)
  const hasReadOnlyIntent = READ_ONLY_FILE_INSPECTION_PATTERNS.some((pattern) => pattern.test(normalized))

  if (!hasReadOnlyIntent) {
    return false
  }

  const hasActualMutationIntent = (
    SAFE_FILE_MUTATION_HINT_PATTERNS.some((pattern) => pattern.test(withoutDescriptivePriorWrite))
    || EXPLICIT_FILE_MUTATION_REQUEST_PATTERNS.some((pattern) => pattern.test(withoutDescriptivePriorWrite))
    || SAFE_FILE_CHANGE_REQUEST_PATTERNS.some((pattern) => pattern.test(withoutDescriptivePriorWrite))
    || getRequiredCompanionExtensionsSafe(withoutDescriptivePriorWrite).length > 0
  )

  return !hasActualMutationIntent
}

function looksLikeFileChangeRequestSafe(value) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return false
  }

  if (looksLikeReadOnlyFileInspectionRequest(normalized)) {
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

function extractExplicitFilePaths(value) {
  const normalizedValue = String(value || '').replace(/([A-Za-z0-9_./-]+)[,，](html|css|js|ts|tsx|jsx|vue|json|md|txt)\b/ig, '$1.$2')
  const matches = normalizedValue.matchAll(/([A-Za-z0-9_./-]+\.(html|css|js|ts|tsx|jsx|vue|json|md|txt))/ig)
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
      `Candidate skill: ${skill.name} (${skill.skillId}).`
    ]

    if (skill.description) {
      promptSections.push(`Skill purpose: ${skill.description}`)
    }

    promptSections.push('Detailed Skill instructions are not loaded yet. If you need this Skill, call the skill tool with mode="help" first, then mode="run".')

    if (Array.isArray(skill.preferredTools) && skill.preferredTools.length) {
      promptSections.push(`After this Skill is running, prefer these tools or namespaces when relevant: ${skill.preferredTools.join(', ')}`)
    }

    if (Array.isArray(skill.allowedTools) && skill.allowedTools.length) {
      promptSections.push(`After this Skill is running, only use these tools or namespaces, except the skill tool: ${skill.allowedTools.join(', ')}`)
    }

    if (Array.isArray(skill.disabledTools) && skill.disabledTools.length) {
      promptSections.push(`After this Skill is running, never use these tools or namespaces: ${skill.disabledTools.join(', ')}`)
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

const SKILL_TOOL_NAME = 'skill'
const SKILL_HELP_MAX_CHARS = 6000
const MEMORY_TOOL_NAME = 'memory'
const MEMORY_PROFILE_MAX_REPLY_CHARS = 2000

function buildSkillHelpText(instruction) {
  const normalizedInstruction = normalizeTrimmedString(instruction)

  if (normalizedInstruction.length <= SKILL_HELP_MAX_CHARS) {
    return normalizedInstruction
  }

  return [
    normalizedInstruction.slice(0, SKILL_HELP_MAX_CHARS),
    '',
    `[Skill help truncated: showing first ${SKILL_HELP_MAX_CHARS} of ${normalizedInstruction.length} characters. Put the most important rules at the top of the Skill file.]`
  ].join('\n')
}

function buildSkillCatalogPrompt(skills = [], selectedSkillIds = []) {
  const normalizedSkills = (Array.isArray(skills) ? skills : [])
    .filter(Boolean)
  const selectedSet = new Set(
    (Array.isArray(selectedSkillIds) ? selectedSkillIds : [])
      .map((item) => normalizeTrimmedString(item))
      .filter(Boolean)
  )

  if (!normalizedSkills.length) {
    return ''
  }

  const skillLines = normalizedSkills.map((skill) => {
    const skillId = normalizeTrimmedString(skill.skillId)
    const name = normalizeTrimmedString(skill.name) || skillId
    const description = normalizeTrimmedString(skill.description) || 'No description.'
    const selectedLabel = selectedSet.has(skillId) ? ' [selected for this session]' : ''
    return `  - ${skillId}: ${name}${selectedLabel}. ${description}`
  })

  return [
    '- skill: Two-phase Skill control tool. Use mode="help" first to read Skill instructions, then mode="run" to activate that Skill for the rest of this task.',
    '  Source: local',
    '  Input schema: {',
    '    "type": "object",',
    '    "properties": {',
    '      "skillId": { "type": "string", "description": "The Skill ID to inspect or activate." },',
    '      "mode": { "type": "string", "enum": ["help", "run"], "description": "Use help first, then run." },',
    '      "command": { "type": "string", "description": "Optional short natural-language instruction for how you intend to use this Skill." }',
    '    },',
    '    "required": ["skillId", "mode"]',
    '  }',
    '  Usage rule: Skill summaries are visible initially, but detailed Skill instructions are lazy-loaded. A selected Skill is not active yet. If a Skill is selected or relevant, call skill with mode="help" first. Only after reading the help result may you call skill with mode="run". After run succeeds, continue with normal workspace tools under that Skill.',
    '  Available Skill summaries:',
    ...skillLines
  ].join('\n')
}

function buildMemoryToolPrompt(userProfileText = '') {
  return [
    '- memory: Long-term user profile memory tool. Use it only when the user reveals durable preferences, stable identity/context, project preferences, recurring workflow rules, or explicitly asks you to remember something.',
    '  Source: local',
    '  Input schema: {',
    '    "type": "object",',
    '    "properties": {',
    '      "action": { "type": "string", "enum": ["save_user_profile"], "description": "Persist an updated long-term user profile." },',
    '      "profile": { "type": "string", "description": "The complete updated user profile in concise Markdown. Preserve useful existing profile items and merge the new durable preference." },',
    '      "reason": { "type": "string", "description": "Short reason for the update." }',
    '    },',
    '    "required": ["action", "profile"]',
    '  }',
    '  Usage rule: Do not save API keys, passwords, tokens, temporary task facts, one-off file contents, or private secrets. If there is no durable user preference to save, do not call this tool.',
    userProfileText
      ? '  Current profile is already provided in the prompt; submit a complete merged profile if you update it.'
      : '  Current profile is empty; create one only when there is durable information worth remembering.'
  ].join('\n')
}

function buildToolPromptWithSkillLoader(toolPromptText, skillCatalogPrompt, memoryToolPrompt = '') {
  return [
    normalizeTrimmedString(skillCatalogPrompt),
    normalizeTrimmedString(memoryToolPrompt),
    normalizeTrimmedString(toolPromptText)
  ].filter(Boolean).join('\n')
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

  if (toolName === MEMORY_TOOL_NAME) {
    const length = Number(toolExecution?.result?.profileLength || 0)
    return length > 0 ? `长期画像：${length} 字符` : '长期画像'
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

function looksLikeInternalReactDecisionContent(value) {
  const trimmed = stripWrappingCodeFences(value)

  if (!trimmed) {
    return false
  }

  if (/"type"\s*:\s*"react_decision"/i.test(trimmed)) {
    return true
  }

  try {
    const parsed = JSON.parse(trimmed)
    const action = parsed?.action

    return (
      parsed?.type === 'react_decision'
      || action === 'tool'
      || action === 'ask_user'
      || (action && typeof action === 'object' && ['tool', 'ask_user', 'final'].includes(normalizeAction(action.type || action.action)))
    )
  } catch {
    return false
  }
}

function looksLikeInternalProtocolText(value) {
  const text = String(value || '').trim()

  if (!text) {
    return false
  }

  return (
    looksLikeInternalReactDecisionContent(text)
    || /"type"\s*:\s*"react_decision"/i.test(text)
    || /"action"\s*:\s*\{\s*"type"\s*:\s*"tool"/i.test(text)
    || /"action"\s*:\s*"tool"/i.test(text)
    || /"tool"\s*:\s*\{\s*"name"/i.test(text)
    || /\bThought\s*:|\bAction\s*:|\bObservation\s*:/i.test(text)
  )
}

function createFinalTextRetryMessages(messages = [], rawReply = '') {
  return [
    ...(Array.isArray(messages) ? messages : []),
    {
      role: 'user',
      content: [
        'The previous final answer used an internal Agent protocol or JSON tool-call format.',
        'Rewrite the final answer now as plain natural language only.',
        'Do not include JSON, code fences, ReAct transcript, tool calls, Thought, Action, or Observation.',
        'Keep it concise and user-facing.',
        '',
        `Blocked internal output preview:\n${truncateText(rawReply, 1200)}`
      ].join('\n')
    }
  ]
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

  if (looksLikeInternalReactDecisionContent(normalizedReply)) {
    return '模型返回了内部工具调用 JSON，本轮已拦截，未展示为正常回复。请重新发送任务；如果是写文件任务，Agent 会继续通过工具真实写入工作区。'
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

function normalizeThoughtSummary(value) {
  return truncateText(normalizeTrimmedString(value), 220)
}

function getDecisionThoughtSummary(decisionJson) {
  return normalizeThoughtSummary(decisionJson?.thought_summary || decisionJson?.thoughtSummary || '')
}

function getDecisionProgressSummary(decisionJson) {
  return normalizeTrimmedString(decisionJson?.summary) || getDecisionThoughtSummary(decisionJson)
}

function normalizeDecisionJson(decisionJson = {}) {
  if (!decisionJson || typeof decisionJson !== 'object' || Array.isArray(decisionJson)) {
    return {}
  }

  const normalized = { ...decisionJson }
  const rawAction = decisionJson.action

  if (rawAction && typeof rawAction === 'object' && !Array.isArray(rawAction)) {
    const nestedActionType = normalizeAction(rawAction.type || rawAction.action)
    const nestedTool = rawAction.tool && typeof rawAction.tool === 'object'
      ? rawAction.tool
      : null

    if (nestedActionType) {
      normalized.action = nestedActionType
    }

    if (!normalized.summary) {
      normalized.summary = rawAction.summary || rawAction.thought_summary || rawAction.thoughtSummary || normalized.thought_summary
    }

    if (!normalized.reply) {
      normalized.reply = rawAction.reply || rawAction.question || rawAction.answer || ''
    }

    if (!normalized.tool && (nestedActionType === 'tool' || rawAction.tool || rawAction.name)) {
      normalized.tool = {
        name: normalizeTrimmedString(rawAction.name || nestedTool?.name || rawAction.tool),
        args: (
          rawAction.args && typeof rawAction.args === 'object' && !Array.isArray(rawAction.args)
            ? rawAction.args
            : nestedTool?.args && typeof nestedTool.args === 'object' && !Array.isArray(nestedTool.args)
              ? nestedTool.args
              : {}
        )
      }
    }
  }

  if (normalizeAction(normalized.action) === 'tool' && typeof normalized.tool === 'string') {
    normalized.tool = {
      name: normalizeTrimmedString(normalized.tool),
      args: {}
    }
  }

  return normalized
}

function createReactObservation(toolExecution) {
  return {
    status: toolExecution.status || 'success',
    summary: toolExecution.summary || '',
    durationMs: Number.isFinite(toolExecution.durationMs) ? toolExecution.durationMs : undefined,
    result: toolExecution.result
  }
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
  ragContextText = '',
  conversationMemoryText = '',
  userProfileText = '',
  currentDateContextText = ''
}) {
  const promptSections = [
    'You are a coding agent running inside a server workspace.',
    'The current session workspace is the only source of truth for this task.',
    'When the user asks to continue modifying previous files, continue working on files that already exist inside the current session workspace.',
    'The user may ask for coding work, workspace investigation, product discussion, brainstorming, or ordinary conversation.',
    'Return strict JSON only.',
    'Do not expose hidden chain-of-thought.',
    'Use structured ReAct, not plain-text ReAct.',
    'Do not emit plain-text "Thought:", "Action:", or "Observation:" sections.',
    'Use the exact decision schema below. The top-level "action" field must be a string, not an object.',
    'Do not return {"type":"react_decision","action":{"type":"tool",...}}; return {"action":"tool","tool":{"name":"...","args":{}}} instead.',
    'Decision phase is only for choosing the next action. Do not put the full final answer in JSON.',
    'When action is "final", keep "reply" empty. The server will ask for the full natural-language answer in a separate final_text phase.',
    'Only action "ask_user" may use "reply", and it must be one concise clarification question.',
    'Each turn must include a brief "thought_summary" that explains the next action at a safe, user-visible level.',
    'Never output private reasoning, hidden chain-of-thought, or step-by-step internal deliberation.',
    'Use the same language as the user.',
    'For ordinary conversation, answer naturally and directly instead of refusing unnecessarily.',
    ...(ragContextText
      ? [
          'A knowledge base is selected for this request.',
          'Use the provided RAG knowledge context first when answering knowledge-based questions.',
          'Do not search Lark/Feishu chat history just because a chat is selected, unless the user explicitly asks to search chat history or send a message.'
        ]
      : []),
    'You may decide one of three actions on each turn:',
    '- "tool": call exactly one available tool when you need workspace evidence.',
    '- "final": provide the final user-facing answer when you have enough information.',
    '- "ask_user": ask exactly one concise clarification question when the task is blocked by missing information.',
    'Use "final" for greetings, everyday Q&A, explanations, brainstorming, summaries, translations, or any request that does not require workspace inspection.',
    'Do not force tool usage when a direct answer is sufficient.',
    'Do not ask clarifying questions unless the missing detail truly blocks a useful next response.',
    'Long-term memory rule: when the user states a durable preference, stable personal/project context, or explicitly asks you to remember something, call the memory tool to update the user profile before the final answer.',
    'Do not store temporary task details, secrets, API keys, passwords, tokens, or file contents in long-term memory.',
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
    '  "thought_summary": "brief safe ReAct thought summary; no hidden reasoning",',
    '  "action": "tool" | "final" | "ask_user",',
    '  "summary": "short public progress update",',
    '  "reply": "only for ask_user; must be empty when action is final or tool",',
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
    ...(ragContextText
      ? [{
          role: 'user',
          content: `RAG knowledge context:\n${ragContextText}`
        }]
      : []),
    ...(conversationMemoryText
      ? [{
          role: 'user',
          content: `Short-term session summary:\n${conversationMemoryText}`
        }]
      : []),
    ...(userProfileText
      ? [{
          role: 'user',
          content: `Long-term user profile memory:\n${userProfileText}`
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

function buildFinalTextMessages({
  latestGoal,
  conversationHistory,
  fileChangesRequired = false,
  modifiedWorkspace = false,
  toolMessages,
  systemPrompt,
  workspaceContextText = '',
  attachmentContextText = '',
  ragContextText = '',
  conversationMemoryText = '',
  userProfileText = '',
  currentDateContextText = ''
}) {
  const promptSections = [
    'You are a coding agent running inside a server workspace.',
    'You are now in the final answer phase.',
    'Do not output JSON.',
    'Do not output a ReAct transcript, Thought, Action, or Observation.',
    'Do not expose hidden chain-of-thought.',
    'Use the same language as the user.',
    'Answer naturally and directly.',
    ...(ragContextText
      ? [
          'A knowledge base is selected for this request.',
          'Use the provided RAG knowledge context first when answering knowledge-based questions.',
          'Do not search Lark/Feishu chat history just because a chat is selected, unless the user explicitly asks to search chat history or send a message.'
        ]
      : []),
    'Base the answer on the gathered evidence and the current session workspace.',
    'If the request never needed workspace tools, answer as a normal conversation.',
    'If ephemeral uploaded files were provided, treat them as reference material for the final answer.',
    'When the user asks for the current date, weekday, or time, use the provided current date context directly.',
    'Use the long-term user profile only as preference/context. Do not mention it unless it is directly useful.',
    ...(modifiedWorkspace
      ? [
          'Files were changed in the workspace.',
          'Keep the final reply concise.',
          'Summarize what changed and which files were affected.',
          'Do not paste full file contents or long code blocks unless the user explicitly asked to see them.'
        ]
      : []),
    ...(fileChangesRequired && !modifiedWorkspace
      ? [
          'The user asked for file changes, but no file was changed.',
          'Explain briefly that the requested file change was not applied and state the blocking reason.',
          'Do not fabricate code changes and do not paste large code blocks.'
        ]
      : [])
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
    ...(ragContextText
      ? [{
          role: 'user',
          content: `RAG knowledge context:\n${ragContextText}`
        }]
      : []),
    ...(conversationMemoryText
      ? [{
          role: 'user',
          content: `Short-term session summary:\n${conversationMemoryText}`
        }]
      : []),
    ...(userProfileText
      ? [{
          role: 'user',
          content: `Long-term user profile memory:\n${userProfileText}`
        }]
      : []),
    ...conversationHistory,
    ...toolMessages,
    {
      role: 'user',
      content: [
        `Latest user message: ${latestGoal}`,
        'Produce the final user-facing answer now as plain natural language.'
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

function createToolTranscriptMessages(toolExecution, {
  thoughtSummary = ''
} = {}) {
  return [
    {
      role: 'assistant',
      content: serializeJson({
        type: 'react_decision',
        thought_summary: normalizeThoughtSummary(thoughtSummary),
        action: 'tool',
        summary: toolExecution.summary || `Called tool ${toolExecution.tool}.`,
        reply: '',
        tool: {
          name: toolExecution.tool,
          args: toolExecution.args
        }
      })
    },
    {
      role: 'user',
      content: serializeJson({
        type: 'react_observation',
        observation: createReactObservation(toolExecution)
      })
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

  if (toolName === SKILL_TOOL_NAME) {
    return `加载 Skill ${truncateText(args?.skillId || '', 36) || ''}`.trim()
  }

  if (toolName === MEMORY_TOOL_NAME) {
    return '更新长期记忆'
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

  if (toolName === SKILL_TOOL_NAME) {
    const skillId = normalizeTrimmedString(args?.skillId || toolExecution?.result?.skillId)
    const mode = normalizeTrimmedString(args?.mode || toolExecution?.result?.mode)
    return skillId ? `Skill：${skillId}${mode ? ` (${mode})` : ''}` : ''
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
    '状态：已选择为候选技能，等待按需加载',
    skillIds.length ? `目标：${skillIds.join(', ')}` : '',
    `结果：本轮已选择技能摘要：${skillNames.join('、')}。如需使用完整技能，Agent 需要先调用 skill mode=help，再调用 skill mode=run。`
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

function buildRagContextText({ collectionId = '', collectionIds = [], items = [] } = {}) {
  const normalizedCollectionIds = [...new Set(
    (Array.isArray(collectionIds) && collectionIds.length ? collectionIds : [collectionId])
      .map((item) => normalizeTrimmedString(item))
      .filter(Boolean)
  )]
  const normalizedItems = Array.isArray(items) ? items : []

  if (!normalizedCollectionIds.length) {
    return ''
  }

  const collectionLabel = normalizedCollectionIds.join(', ')

  if (!normalizedItems.length) {
    return [
      `Selected knowledge base collections: ${collectionLabel}`,
      'The selected knowledge base collections were searched, but no relevant snippets were found.',
      'Do not silently switch to unrelated external tools such as chat history unless the user explicitly asks for that source.',
      'Tell the user that the selected knowledge base collections did not contain matching information.'
    ].join('\n')
  }

  return [
    `Selected knowledge base collections: ${collectionLabel}`,
    'Use the following retrieved knowledge snippets when they are relevant to the user request.',
    'Prioritize these knowledge snippets over unrelated external tools or chat history.',
    'Do not call chat/message-history tools for this question unless the user explicitly asks to search chat history.',
    'If the snippets do not contain enough information, say so instead of fabricating.',
    '',
    ...normalizedItems.slice(0, 8).map((item, index) => [
      `Snippet ${index + 1}:`,
      `Title: ${normalizeTrimmedString(item?.title) || 'Untitled'}`,
      `Document ID: ${normalizeTrimmedString(item?.documentId)}`,
      `Collection ID: ${normalizeTrimmedString(item?.collectionId) || 'unknown'}`,
      `Source: ${normalizeTrimmedString(item?.sourcePath || item?.sourceType) || 'knowledge_base'}`,
      `Score: ${Number.isFinite(Number(item?.score)) ? Number(item.score).toFixed(4) : 'n/a'}`,
      'Content:',
      truncateText(String(item?.content || '').trim(), 1800)
    ].join('\n'))
  ].join('\n\n')
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
  toolRunner,
  ragStore,
  memoryStore,
  auditLogger
} = {}) {
  const activeRuns = new Map()

  function audit(sessionId, event, payload = {}) {
    if (!auditLogger || typeof auditLogger.logEvent !== 'function') {
      return
    }

    auditLogger.logEvent({
      sessionId,
      event,
      ...payload
    })
  }

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

    audit(sessionId, 'ai_message', {
      source: 'buffered',
      model,
      contentPreview: normalizedContent.slice(0, 500),
      contentLength: normalizedContent.length,
      usage
    })

    pushSessionEvent(sessionId, 'assistant.finalized', {
      model
    })

    return message
  }

  async function appendAssistantReplyFromTextCompletion(sessionId, {
    aiConfig,
    model = '',
    messages,
    signal,
    fileChangesRequired = false,
    modifiedWorkspace = false,
    changedFiles = [],
    verifiedAfterModification = false
  } = {}) {
    let latestStreamedContent = ''
    let emittedAnyChunk = false
    const allowRawFinalStreaming = !fileChangesRequired && !modifiedWorkspace
    let suppressRawStreaming = !allowRawFinalStreaming

    audit(sessionId, 'llm_input', {
      stage: 'final_text',
      model,
      messageCount: Array.isArray(messages) ? messages.length : 0
    })

    const requestFinalTextCompletion = async (requestMessages) => createTextCompletion({
      aiConfig,
      model,
      messages: requestMessages,
      requestTimeoutMs: aiRuntimeConfig.requestTimeoutMs,
      idleTimeoutMs: aiRuntimeConfig.idleTimeoutMs,
      streamResponses: aiRuntimeConfig.streamResponses,
      timeoutRetries: aiRuntimeConfig.timeoutRetries,
      timeoutRetryDelayMs: aiRuntimeConfig.timeoutRetryDelayMs,
      signal,
      onTextChunk: (deltaText, fullText) => {
        const nextContent = String(fullText || '')

        if (!nextContent) {
          return
        }

        if (looksLikeInternalProtocolText(nextContent)) {
          suppressRawStreaming = true
          return
        }

        if (suppressRawStreaming) {
          return
        }

        emittedAnyChunk = true
        latestStreamedContent = nextContent
        pushSessionEvent(sessionId, 'assistant.partial', {
          content: nextContent,
          model
        })
      }
    })

    let completion = await requestFinalTextCompletion(messages)
    let rawReply = normalizeTrimmedString(completion.text || completion.rawText || latestStreamedContent)

    if (looksLikeInternalProtocolText(rawReply)) {
      audit(sessionId, 'system_action', {
        action: 'final_text_protocol_retry',
        model,
        rawPreview: rawReply.slice(0, 500)
      })

      latestStreamedContent = ''
      emittedAnyChunk = false
      suppressRawStreaming = !allowRawFinalStreaming
      audit(sessionId, 'llm_input', {
        stage: 'final_text_retry',
        model,
        messageCount: Array.isArray(messages) ? messages.length + 1 : 1
      })
      completion = await requestFinalTextCompletion(createFinalTextRetryMessages(messages, rawReply))
      rawReply = normalizeTrimmedString(completion.text || completion.rawText || latestStreamedContent)
    }

    const safeReply = buildSafeAssistantReply({
      reply: rawReply,
      fileChangesRequired,
      modifiedWorkspace,
      changedFiles,
      verifiedAfterModification
    })

    if (!safeReply) {
      throw new Error('Model returned an empty final answer.')
    }

    if (!emittedAnyChunk || safeReply !== latestStreamedContent) {
      pushSessionEvent(sessionId, 'assistant.partial', {
        content: safeReply,
        model
      })
    }

    const message = await sessionRepository.appendAssistantMessage(sessionId, {
      content: safeReply,
      model,
      usage: completion.usage
    })

    audit(sessionId, 'llm_final_text', {
      model,
      contentPreview: safeReply.slice(0, 500),
      contentLength: safeReply.length,
      usage: completion.usage
    })
    audit(sessionId, 'ai_message', {
      source: 'final_text_completion',
      model,
      contentPreview: safeReply.slice(0, 500),
      contentLength: safeReply.length,
      usage: completion.usage
    })

    pushSessionEvent(sessionId, 'assistant.finalized', {
      model
    })

    return {
      message,
      reply: safeReply,
      usage: completion.usage
    }
  }

  async function appendFailureAssistantMessage(sessionId, summary, model = '') {
    const normalizedSummary = normalizeTrimmedString(summary) || '\u4efb\u52a1\u6267\u884c\u5931\u8d25\u3002'
  
    return appendAssistantReplyWithStreaming(sessionId, {
      content: `\u5904\u7406\u5931\u8d25\uff1a${normalizedSummary}`,
      model
    })
  }

  async function ensureConversationMemory({
    sessionId,
    session,
    aiConfig,
    selectedModel,
    signal
  } = {}) {
    if (!aiRuntimeConfig?.contextMemoryEnabled) {
      return normalizeMemorySummary(session?.memorySummary, aiRuntimeConfig?.contextMemoryMaxChars)
    }

    const messages = Array.isArray(session?.messages) ? session.messages : []
    const threshold = Math.max(1, Number(aiRuntimeConfig.contextMemoryThreshold || 24))
    const keepMessages = Math.max(1, Number(aiRuntimeConfig.contextMemoryKeepMessages || aiRuntimeConfig.recentMessages || 12))
    const minBatchMessages = Math.max(1, Number(aiRuntimeConfig.contextMemoryMinBatchMessages || 4))
    const maxChars = Math.max(1000, Number(aiRuntimeConfig.contextMemoryMaxChars || 6000))
    const currentMemoryCount = normalizeMemoryMessageCount(session?.memoryMessageCount, messages.length)
    const cutoffIndex = Math.max(0, messages.length - keepMessages)
    const messagesToCompress = messages.slice(currentMemoryCount, cutoffIndex)
    const existingSummary = normalizeMemorySummary(session?.memorySummary, maxChars)

    if (
      messages.length <= threshold
      || cutoffIndex <= currentMemoryCount
      || messagesToCompress.length < minBatchMessages
    ) {
      return existingSummary
    }

    try {
      const completion = await createStructuredCompletion({
        aiConfig,
        model: selectedModel,
        messages: createMemorySummaryMessages({
          existingSummary,
          messagesToCompress,
          maxChars
        }),
        requestTimeoutMs: aiRuntimeConfig.requestTimeoutMs,
        idleTimeoutMs: aiRuntimeConfig.idleTimeoutMs,
        streamResponses: false,
        timeoutRetries: Math.min(1, Number(aiRuntimeConfig.timeoutRetries || 0)),
        timeoutRetryDelayMs: aiRuntimeConfig.timeoutRetryDelayMs,
        signal
      })
      const nextSummary = normalizeMemorySummary(
        completion?.json?.summary || completion?.json?.reply || completion?.rawText,
        maxChars
      )

      if (!nextSummary) {
        return existingSummary
      }

      await sessionRepository.updateSession(sessionId, (draftSession) => {
        const keptMessages = messages.slice(cutoffIndex)
        draftSession.memorySummary = nextSummary
        draftSession.memoryUpdatedAt = nowIso()
        draftSession.memoryMessageCount = 0
        draftSession.memoryCompressedThroughMessageId = normalizeTrimmedString(messages[cutoffIndex - 1]?.messageId)
        draftSession.messages = keptMessages
        draftSession.updatedAt = nowIso()
        return draftSession
      })

      audit(sessionId, 'system_action', {
        action: 'memory_compacted',
        compressedMessageCount: messagesToCompress.length,
        keptMessageCount: messages.length - cutoffIndex,
        summaryLength: nextSummary.length,
        model: selectedModel
      })

      return nextSummary
    } catch (error) {
      audit(sessionId, 'error', {
        scope: 'memory_compaction',
        message: error instanceof Error ? error.message : String(error || '')
      })
      console.warn('[agent-runner] failed to compress conversation memory:', error instanceof Error ? error.message : error)
      return existingSummary
    }
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
    requestedManualSkillIds = [],
    requestedMcpServerIds = [],
    requestedMcpToolPrefixes = [],
    requestedAttachments = [],
    requestedRagCollectionId = '',
    requestedRagCollectionIds = [],
    requestedEmbeddingAiId = '',
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
    const activeSkillPrompt = buildActiveSkillPrompt(activeSkills)
    const activeSkillIds = activeSkills
      .map((item) => normalizeTrimmedString(item.skillId))
      .filter(Boolean)
    const manualSkillIds = [...new Set(
      (Array.isArray(requestedManualSkillIds) ? requestedManualSkillIds : [])
        .map((item) => normalizeTrimmedString(item))
        .filter(Boolean)
    )]
    const skillRuntimeState = new Map()
    const resolveRuntimeSkill = (skillId) => (
      skillRegistry && typeof skillRegistry.getSkillById === 'function'
        ? skillRegistry.getSkillById(skillId)
        : null
    )
    const getRuntimeActiveSkill = () => {
      const runningSkills = [...skillRuntimeState.entries()]
        .filter(([, state]) => state?.running)
        .map(([skillId]) => resolveRuntimeSkill(skillId))
        .filter(Boolean)

      return mergeActiveSkills(runningSkills)
    }
    const skillCatalogPrompt = buildSkillCatalogPrompt(
      skillRegistry && typeof skillRegistry.listSkills === 'function'
        ? skillRegistry.listSkills()
        : activeSkills,
      activeSkillIds
    )
    const activeMcpToolPrefixes = Array.isArray(requestedMcpToolPrefixes)
      ? requestedMcpToolPrefixes.map((item) => String(item || '').trim()).filter(Boolean)
      : []

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
    audit(sessionId, 'system_action', {
      action: 'task_started',
      taskId,
      aiId: aiConfig.aiId,
      model: selectedModel,
      skillIds: activeSkills.map((item) => item.skillId),
      mcpServerIds: requestedMcpServerIds,
      mcpToolPrefixes: activeMcpToolPrefixes,
      ragCollectionIds: requestedRagCollectionIds,
      embeddingAiId: requestedEmbeddingAiId,
      attachmentCount: requestedAttachments.length
    })
    const conversationMemoryText = await ensureConversationMemory({
      sessionId,
      session,
      aiConfig,
      selectedModel,
      signal: abortSignal
    })
    let userProfileText = ''

    if (aiRuntimeConfig?.userProfileMemoryEnabled && memoryStore && typeof memoryStore.readUserProfile === 'function') {
      try {
        userProfileText = await memoryStore.readUserProfile()
      } catch (error) {
        audit(sessionId, 'error', {
          scope: 'user_profile_memory_read',
          message: error instanceof Error ? error.message : String(error || '')
        })
        console.warn('[agent-runner] failed to read user profile memory:', error instanceof Error ? error.message : error)
      }
    }

    const conversationHistory = toChatHistorySafe(
      getRecentMessages(session.messages || [], aiRuntimeConfig.recentMessages)
    )
    const latestGoal = String(latestUserMessage.content)
    const fileChangesRequired = looksLikeFileChangeRequestSafe(latestGoal)
    const requiredCompanionExtensions = getRequiredCompanionExtensionsSafe(latestGoal)
    const currentDateContextText = buildCurrentDateContext(runtimeConfig?.timezone)
    const attachmentContextText = buildAttachmentContextText(requestedAttachments)
    let ragContextText = ''
    const normalizedRagCollectionIds = [...new Set(
      (Array.isArray(requestedRagCollectionIds) && requestedRagCollectionIds.length
        ? requestedRagCollectionIds
        : [requestedRagCollectionId])
        .map((item) => normalizeTrimmedString(item))
        .filter(Boolean)
    )]
    const normalizedEmbeddingAiId = normalizeTrimmedString(requestedEmbeddingAiId)
    const getAvailableToolPromptText = () => buildToolPromptWithSkillLoader(
      toolRunner.getPromptText({ skill: getRuntimeActiveSkill(), mcpToolPrefixes: activeMcpToolPrefixes }),
      skillCatalogPrompt,
      aiRuntimeConfig?.userProfileMemoryEnabled ? buildMemoryToolPrompt(userProfileText) : ''
    )

    if (normalizedRagCollectionIds.length && ragStore && typeof ragStore.search === 'function') {
      try {
        audit(sessionId, 'rag_search', {
          status: 'started',
          collectionIds: normalizedRagCollectionIds,
          embeddingAiId: normalizedEmbeddingAiId,
          queryPreview: latestGoal.slice(0, 500)
        })
        publishTaskProgress(sessionId, '正在检索当前知识库...', selectedModel)
        const ragItemGroups = await Promise.all(
          normalizedRagCollectionIds.map((collectionId) => ragStore.search({
            query: latestGoal,
            collectionId,
            embeddingAiId: normalizedEmbeddingAiId
          }))
        )
        const ragItems = ragItemGroups.flat()
        ragContextText = buildRagContextText({
          collectionIds: normalizedRagCollectionIds,
          items: ragItems
        })
        audit(sessionId, 'rag_search', {
          status: 'success',
          collectionIds: normalizedRagCollectionIds,
          embeddingAiId: normalizedEmbeddingAiId,
          hitCount: ragItems.length
        })
        publishTaskProgress(sessionId, `知识库检索完成，命中 ${ragItems.length} 条内容。`, selectedModel)
      } catch (error) {
        audit(sessionId, 'rag_search', {
          status: 'failed',
          collectionIds: normalizedRagCollectionIds,
          embeddingAiId: normalizedEmbeddingAiId,
          message: error instanceof Error ? error.message : String(error || '')
        })
        console.warn('[agent-runner] failed to retrieve RAG context:', error instanceof Error ? error.message : error)
      }
    }
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
      autoVerificationAttempted: false,
      updatedUserProfileMemory: false
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
      thoughtSummary = '',
      stepTitle = ''
    } = {}) {
      throwIfCancelled()
      throwIfTaskTimedOut()

      const normalizedRequest = normalizeToolRequest(toolRequest)
      const toolExecutionId = createId('tool')
      const isMcpTool = normalizedRequest.name.startsWith('mcp.')
      const isMemoryTool = normalizedRequest.name === MEMORY_TOOL_NAME
      const auditArgs = isMemoryTool
        ? {
            action: normalizeTrimmedString(normalizedRequest.args?.action),
            reason: normalizeTrimmedString(normalizedRequest.args?.reason),
            profileLength: String(normalizedRequest.args?.profile || '').length
          }
        : normalizedRequest.args
      audit(sessionId, isMcpTool ? 'mcp_call' : 'tool_call', {
        executionId: toolExecutionId,
        tool: normalizedRequest.name,
        args: auditArgs,
        thoughtSummary,
        status: 'started'
      })
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
        if (normalizedRequest.name === SKILL_TOOL_NAME) {
          const skillId = normalizeTrimmedString(normalizedRequest.args?.skillId)
          const mode = normalizeTrimmedString(normalizedRequest.args?.mode).toLowerCase()
          const command = normalizeTrimmedString(normalizedRequest.args?.command)
          const skill = resolveRuntimeSkill(skillId)

          if (!skill) {
            throw new Error(`Unknown skill: ${skillId || '(empty)'}.`)
          }

          if (!['help', 'run'].includes(mode)) {
            throw new Error('Skill tool requires mode to be either "help" or "run".')
          }

          const previousState = skillRuntimeState.get(skill.skillId) || {
            helped: false,
            running: false,
            instructionLength: 0
          }

          if (mode === 'run' && !previousState.helped) {
            toolExecution = {
              tool: SKILL_TOOL_NAME,
              args: {
                skillId,
                mode,
                ...(command ? { command } : {})
              },
              result: {
                skillId: skill.skillId,
                name: skill.name,
                description: skill.description,
                mode,
                command,
                instruction: '',
                instructionLength: 0,
                helped: false,
                running: false,
                blocked: true,
                reason: 'help_required'
              },
              summary: `Skill ${skill.name || skill.skillId} requires mode="help" before mode="run".`,
              message: `Skill ${skill.name || skill.skillId} run was not activated because help has not been read yet.`,
              status: 'success',
              durationMs: Date.now() - toolStartedAt
            }
          } else {
            const instruction = mode === 'help'
              ? normalizeTrimmedString(
                typeof skillRegistry?.loadSkillInstruction === 'function'
                  ? skillRegistry.loadSkillInstruction(skill.skillId)
                  : ''
              )
              : ''

            if (mode === 'help' && !instruction) {
              throw new Error(`Skill "${skillId}" has no loadable instruction.`)
            }

            const helpInstruction = mode === 'help' ? buildSkillHelpText(instruction) : ''
            const instructionLength = mode === 'help'
              ? instruction.length
              : Number(previousState.instructionLength || 0)
            const nextState = {
              helped: previousState.helped || mode === 'help',
              running: previousState.running || mode === 'run',
              instructionLength
            }
            skillRuntimeState.set(skill.skillId, nextState)

            toolExecution = {
              tool: SKILL_TOOL_NAME,
              args: {
                skillId,
                mode,
                ...(command ? { command } : {})
              },
              result: {
                skillId: skill.skillId,
                name: skill.name,
                description: skill.description,
                mode,
                command,
                instruction: mode === 'help' ? helpInstruction : '',
                instructionLength,
                helpLength: mode === 'help' ? helpInstruction.length : 0,
                truncated: mode === 'help' ? helpInstruction.length < instruction.length : false,
                helped: nextState.helped,
                running: nextState.running
              },
              summary: mode === 'help'
                ? `Loaded Skill help for ${skill.name || skill.skillId}.`
                : `Skill ${skill.name || skill.skillId} is now running for this task.`,
              message: mode === 'help'
                ? `Skill ${skill.name || skill.skillId} help loaded.`
                : `Skill ${skill.name || skill.skillId} run mode activated.`,
              status: 'success',
              durationMs: Date.now() - toolStartedAt
            }
          }
        } else if (normalizedRequest.name === MEMORY_TOOL_NAME) {
          const action = normalizeTrimmedString(normalizedRequest.args?.action).toLowerCase()
          const profile = normalizeTrimmedString(normalizedRequest.args?.profile)
          const reason = normalizeTrimmedString(normalizedRequest.args?.reason)

          if (!aiRuntimeConfig?.userProfileMemoryEnabled) {
            throw new Error('Long-term user profile memory is disabled.')
          }

          if (!memoryStore || typeof memoryStore.writeUserProfile !== 'function') {
            throw new Error('Long-term user profile memory store is not available.')
          }

          if (action !== 'save_user_profile') {
            throw new Error('Memory tool requires action="save_user_profile".')
          }

          if (!profile) {
            throw new Error('Memory tool requires a non-empty profile.')
          }

          const savedProfile = await memoryStore.writeUserProfile(profile, { reason })
          userProfileText = savedProfile.profile || ''
          executionState.updatedUserProfileMemory = true

          toolExecution = {
            tool: MEMORY_TOOL_NAME,
            args: {
              action,
              ...(reason ? { reason } : {})
            },
            result: {
              action,
              updatedAt: savedProfile.updatedAt,
              profileLength: userProfileText.length,
              profilePreview: truncateText(userProfileText, MEMORY_PROFILE_MAX_REPLY_CHARS),
              reason
            },
            summary: 'Long-term user profile memory updated.',
            message: 'Long-term user profile memory updated.',
            status: 'success',
            durationMs: Date.now() - toolStartedAt
          }
        } else {
          toolExecution = await toolRunner.executeToolCall(normalizedRequest, {
            skill: getRuntimeActiveSkill(),
            mcpToolPrefixes: activeMcpToolPrefixes,
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
        }
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
        audit(sessionId, isMcpTool ? 'mcp_result' : 'tool_result', {
          executionId: toolExecutionId,
          tool: normalizedRequest.name,
          status: 'failed',
          durationMs: Date.now() - toolStartedAt,
          message: errorMessage
        })
        audit(sessionId, 'error', {
          scope: isMcpTool ? 'mcp_tool' : 'tool',
          executionId: toolExecutionId,
          tool: normalizedRequest.name,
          message: errorMessage
        })
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
      toolMessages.push(...createToolTranscriptMessages(toolExecution, { thoughtSummary }))
      publishTaskProgress(sessionId, toolExecution.summary, selectedModel)
      audit(sessionId, isMcpTool ? 'mcp_result' : 'tool_result', {
        executionId: toolExecutionId,
        tool: toolExecution.tool,
        status: 'success',
        durationMs: toolExecution.durationMs,
        summary: toolExecution.summary,
        result: toolExecution.result
      })
      if (toolExecution.tool === SKILL_TOOL_NAME) {
        audit(sessionId, 'system_action', {
          action: toolExecution.result?.blocked
            ? 'skill_run_blocked'
            : toolExecution.result?.mode === 'run'
              ? 'skill_run'
              : 'skill_help',
          executionId: toolExecutionId,
          skillId: toolExecution.result?.skillId,
          skillName: toolExecution.result?.name,
          mode: toolExecution.result?.mode,
          instructionLength: toolExecution.result?.instructionLength,
          running: toolExecution.result?.running
        })
      }
      if (toolExecution.tool === MEMORY_TOOL_NAME) {
        audit(sessionId, 'system_action', {
          action: 'user_profile_memory_updated',
          executionId: toolExecutionId,
          profileLength: toolExecution.result?.profileLength,
          reason: toolExecution.result?.reason
        })
      }

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

        audit(sessionId, 'workspace_write', {
          executionId: toolExecutionId,
          tool: toolExecution.tool,
          path: writtenPath,
          changed: toolExecution.result?.changed !== false,
          sizeBytes: toolExecution.result?.sizeBytes ?? null
        })

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

        const loopMessages = buildAgentLoopMessages({
          latestGoal,
          conversationHistory,
          requireFileChanges: fileChangesRequired,
          toolMessages,
          toolPromptText: getAvailableToolPromptText(),
          systemPrompt: [aiConfig.systemPrompt, activeSkillPrompt].filter(Boolean).join('\n\n'),
          remainingIterations: runtimeConfig.maxToolIterations - iteration,
          workspaceContextText,
          attachmentContextText,
          ragContextText,
          conversationMemoryText,
          userProfileText,
          currentDateContextText
        })
        audit(sessionId, 'llm_input', {
          stage: 'decision',
          iteration,
          model: selectedModel,
          messageCount: loopMessages.length,
          toolMessageCount: toolMessages.length,
          ragContext: Boolean(ragContextText),
          memoryContext: Boolean(conversationMemoryText),
          userProfileMemoryContext: Boolean(userProfileText)
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
          messages: loopMessages
        })
        throwIfCancelled()
        throwIfTaskTimedOut()

        const decisionJson = normalizeDecisionJson(decision.json)
        const action = normalizeAction(decisionJson.action)
        if (action === 'final') {
          decisionJson.reply = ''
        }
        const thoughtSummary = getDecisionThoughtSummary(decisionJson)
        const decisionSummary = getDecisionProgressSummary(decisionJson)
        audit(sessionId, 'llm_decision', {
          stage: 'decision',
          iteration,
          model: selectedModel,
          action,
          thoughtSummary,
          summary: decisionSummary,
          tool: decisionJson.tool
            ? {
                name: decisionJson.tool.name,
                args: decisionJson.tool.args
              }
            : null,
          usage: decision.usage
        })

        if (action === 'tool') {
          taskSteps[0] = completeStep(
            taskSteps[0],
            decisionSummary || '已分析目标，开始检查工作区。'
          )

          const result = await executeToolRequest(decisionJson.tool, {
            summary: decisionSummary || `正在执行工具 ${normalizeTrimmedString(decisionJson.tool?.name) || ''}。`,
            thoughtSummary
          })

          if (!result.ok) {
            return
          }

          await sleep(runtimeConfig.stepDelayMs)
          continue
        }

        if (action === 'ask_user') {
          const reply = normalizeTrimmedString(decisionJson.reply || decisionJson.question) || '我还缺少一项关键信息，你可以再补充一点吗？'
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

        const manualSkillsNeedingRun = manualSkillIds.filter((skillId) => (
          !skillRuntimeState.get(skillId)?.running
        ))

        if (manualSkillsNeedingRun.length) {
          toolMessages.push({
            role: 'user',
            content: [
              `The user manually selected Skill(s): ${manualSkillsNeedingRun.join(', ')}.`,
              'A manually selected Skill is not active until the two-phase Skill protocol completes.',
              'Do not finish yet.',
              'For each needed selected Skill, first call tool "skill" with mode="help", then call tool "skill" with mode="run".',
              'After run succeeds, continue the task or provide the final answer.'
            ].join('\n')
          })

          await sleep(runtimeConfig.stepDelayMs)
          continue
        }

        if (
          aiRuntimeConfig?.userProfileMemoryEnabled
          && looksLikeUserProfileMemoryRequest(latestGoal)
          && !executionState.updatedUserProfileMemory
        ) {
          toolMessages.push({
            role: 'user',
            content: [
              'The latest user message appears to contain an explicit durable memory or preference request.',
              'Do not finish yet.',
              'Call tool "memory" with action="save_user_profile" and a complete concise Markdown profile that merges the existing profile with this durable preference.',
              'Do not store secrets, temporary task details, or file contents.'
            ].join('\n')
          })

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
        audit(sessionId, 'system_action', {
          action: 'task_completed',
          taskId,
          summary: completionSummary,
          changedFiles: executionState.changedFiles,
          verifiedAfterModification: executionState.verifiedAfterModification
        })

        publishTaskProgress(sessionId, '正在整理最终回复。', selectedModel)

        await appendAssistantReplyFromTextCompletion(sessionId, {
          aiConfig,
          model: selectedModel,
          signal: abortSignal,
          messages: buildFinalTextMessages({
            latestGoal,
            conversationHistory,
            fileChangesRequired,
            modifiedWorkspace: executionState.modifiedWorkspace,
            toolMessages,
            systemPrompt: [aiConfig.systemPrompt, activeSkillPrompt].filter(Boolean).join('\n\n'),
            workspaceContextText,
            attachmentContextText,
            ragContextText,
            conversationMemoryText,
            userProfileText,
            currentDateContextText
          }),
          fileChangesRequired,
          modifiedWorkspace: executionState.modifiedWorkspace,
          changedFiles: executionState.changedFiles,
          verifiedAfterModification: executionState.verifiedAfterModification
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

      if (
        executionState.modifiedWorkspace
        && requiredCompanionExtensions.length
        && !hasRequiredCompanionChanges(requiredCompanionExtensions, executionState.changedFiles)
      ) {
        throw new Error(`The requested file split is incomplete. Missing companion file update for: ${requiredCompanionExtensions.join(', ')}`)
      }

      const completionSummary = executionState.modifiedWorkspace
        ? '已基于当前工作区结果完成答复。'
        : '已基于已收集的信息完成答复。'
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
      audit(sessionId, 'system_action', {
        action: 'task_completed',
        taskId,
        summary: completionSummary,
        changedFiles: executionState.changedFiles,
        verifiedAfterModification: executionState.verifiedAfterModification
      })

      publishTaskProgress(sessionId, '正在整理最终回复。', selectedModel)

      await appendAssistantReplyFromTextCompletion(sessionId, {
        aiConfig,
        model: selectedModel,
        signal: abortSignal,
        messages: buildFinalTextMessages({
          latestGoal,
          conversationHistory,
          fileChangesRequired,
          modifiedWorkspace: executionState.modifiedWorkspace,
          toolMessages,
          systemPrompt: [aiConfig.systemPrompt, activeSkillPrompt].filter(Boolean).join('\n\n'),
          workspaceContextText,
          attachmentContextText,
          ragContextText,
          conversationMemoryText,
          userProfileText,
          currentDateContextText
        }),
        fileChangesRequired,
        modifiedWorkspace: executionState.modifiedWorkspace,
        changedFiles: executionState.changedFiles,
        verifiedAfterModification: executionState.verifiedAfterModification
      })
      return
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
        audit(sessionId, 'system_action', {
          action: 'task_cancelled',
          taskId,
          summary: cancelledSummary
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
      audit(sessionId, 'error', {
        scope: 'task',
        taskId,
        message: failureSummary
      })
      audit(sessionId, 'system_action', {
        action: 'task_failed',
        taskId,
        summary: failureSummary
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
