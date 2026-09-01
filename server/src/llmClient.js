import { setTimeout as delay } from 'node:timers/promises'

const AI_PROTOCOL_OPENAI = 'openai'
const AI_PROTOCOL_ANTHROPIC = 'anthropic'
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_ANTHROPIC_MAX_TOKENS = 8192

function normalizeAiProtocol(value) {
  const normalized = String(value || '').trim().toLowerCase()

  if (['anthropic', 'anthropic-messages', 'messages', 'claude'].includes(normalized)) {
    return AI_PROTOCOL_ANTHROPIC
  }

  if (['openai', 'openai-compatible', 'chat-completions', 'chat'].includes(normalized)) {
    return AI_PROTOCOL_OPENAI
  }

  return ''
}

function normalizeUrlPathname(baseURL) {
  try {
    return new URL(baseURL).pathname.replace(/\/+$/, '').toLowerCase()
  } catch {
    return ''
  }
}

function isKnownOpenAiCompatibleHost(hostname) {
  return [
    'openai.com',
    'siliconflow.cn',
    'bigmodel.cn',
    'api.mimo.ai',
    'xiaomi.com',
    'openrouter.ai',
    'deepseek.com',
    'moonshot.cn',
    'dashscope.aliyuncs.com',
    'volces.com',
    'groq.com',
    'together.xyz'
  ].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

export function resolveAiProtocol({ aiConfig, model } = {}) {
  const explicitProtocol = normalizeAiProtocol(
    aiConfig?.apiProtocol || aiConfig?.protocol || aiConfig?.provider
  )

  if (explicitProtocol) {
    return explicitProtocol
  }

  const baseURL = String(aiConfig?.baseURL || '').trim()
  const hostname = normalizeHostname(baseURL)
  const pathname = normalizeUrlPathname(baseURL)
  const normalizedModel = String(model || '').trim().toLowerCase()

  if (pathname.endsWith('/messages')) {
    return AI_PROTOCOL_ANTHROPIC
  }

  if (pathname.endsWith('/chat/completions')) {
    return AI_PROTOCOL_OPENAI
  }

  if (
    hostname === 'anthropic.com'
    || hostname.endsWith('.anthropic.com')
    || hostname.includes('anthropic')
    || pathname.includes('/anthropic/')
  ) {
    return AI_PROTOCOL_ANTHROPIC
  }

  // Known gateways expose Claude models through the OpenAI-compatible schema.
  // Check their hostnames before using the model name as a protocol hint.
  if (isKnownOpenAiCompatibleHost(hostname)) {
    return AI_PROTOCOL_OPENAI
  }

  if (
    normalizedModel === 'claude'
    || normalizedModel.startsWith('claude-')
    || normalizedModel.startsWith('anthropic/')
    || normalizedModel.includes('/claude-')
  ) {
    return AI_PROTOCOL_ANTHROPIC
  }

  return AI_PROTOCOL_OPENAI
}

function resolveOpenAiEndpoint(baseURL) {
  const normalizedBaseURL = String(baseURL || '').trim().replace(/\/+$/, '')

  if (normalizedBaseURL.endsWith('/chat/completions')) {
    return normalizedBaseURL
  }

  return `${normalizedBaseURL}/chat/completions`
}

function resolveAnthropicEndpoint(baseURL) {
  const normalizedBaseURL = String(baseURL || '').trim().replace(/\/+$/, '')

  if (normalizedBaseURL.endsWith('/messages')) {
    return normalizedBaseURL
  }

  try {
    const parsedUrl = new URL(normalizedBaseURL)
    const pathname = parsedUrl.pathname.replace(/\/+$/, '')

    parsedUrl.pathname = pathname && pathname !== '/'
      ? `${pathname}/messages`
      : '/v1/messages'

    return parsedUrl.toString()
  } catch {
    return `${normalizedBaseURL}/messages`
  }
}

function resolveEndpoint(baseURL, protocol) {
  return protocol === AI_PROTOCOL_ANTHROPIC
    ? resolveAnthropicEndpoint(baseURL)
    : resolveOpenAiEndpoint(baseURL)
}

function resolveAnthropicVersion(aiConfig) {
  return String(
    aiConfig?.anthropicVersion
    || process.env.AGENT_ANTHROPIC_VERSION
    || DEFAULT_ANTHROPIC_VERSION
  ).trim() || DEFAULT_ANTHROPIC_VERSION
}

function resolveAnthropicMaxTokens(aiConfig) {
  const parsedValue = Number.parseInt(
    aiConfig?.maxOutputTokens
    || aiConfig?.maxTokens
    || process.env.AGENT_ANTHROPIC_MAX_TOKENS,
    10
  )

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_ANTHROPIC_MAX_TOKENS
}

function buildRequestHeaders(aiConfig, protocol, streamResponses) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: streamResponses ? 'text/event-stream, application/json' : 'application/json'
  }

  if (protocol === AI_PROTOCOL_ANTHROPIC) {
    headers['x-api-key'] = aiConfig.apiKey
    headers['anthropic-version'] = resolveAnthropicVersion(aiConfig)

    if (aiConfig.anthropicBeta) {
      headers['anthropic-beta'] = String(aiConfig.anthropicBeta).trim()
    }

    return headers
  }

  headers.Authorization = `Bearer ${aiConfig.apiKey}`
  return headers
}

function normalizeMessageText(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return content == null ? '' : String(content)
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }

      if (typeof item?.text === 'string') {
        return item.text
      }

      if (typeof item?.content === 'string') {
        return item.content
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function toAnthropicMessages(messages = []) {
  const systemParts = []
  const normalizedMessages = []

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || '').trim().toLowerCase()
    const content = normalizeMessageText(message?.content).trim()

    if (!content) {
      continue
    }

    if (role === 'system' || role === 'developer') {
      systemParts.push(content)
      continue
    }

    const anthropicRole = role === 'assistant' ? 'assistant' : 'user'
    const previousMessage = normalizedMessages[normalizedMessages.length - 1]

    if (previousMessage?.role === anthropicRole) {
      previousMessage.content = `${previousMessage.content}\n\n${content}`
      continue
    }

    normalizedMessages.push({
      role: anthropicRole,
      content
    })
  }

  return {
    system: systemParts.join('\n\n'),
    messages: normalizedMessages
  }
}

function buildAnthropicRequestBody({ aiConfig, model, messages, streamResponses } = {}) {
  const normalizedMessages = toAnthropicMessages(messages)
  const body = {
    model,
    max_tokens: resolveAnthropicMaxTokens(aiConfig),
    temperature: 0.4,
    messages: normalizedMessages.messages
  }

  if (normalizedMessages.system) {
    body.system = normalizedMessages.system
  }

  if (streamResponses) {
    body.stream = true
  }

  return body
}

function extractTextContent(payload) {
  if (Array.isArray(payload?.content)) {
    return payload.content
      .map((item) => (
        typeof item?.text === 'string'
          ? item.text
          : typeof item === 'string'
            ? item
            : ''
      ))
      .join('\n')
      .trim()
  }

  if (typeof payload?.choices?.[0]?.message?.content === 'string') {
    return payload.choices[0].message.content
  }

  if (Array.isArray(payload?.choices?.[0]?.message?.content)) {
    return payload.choices[0].message.content
      .map((item) => (
        typeof item?.text === 'string'
          ? item.text
          : typeof item === 'string'
            ? item
            : ''
      ))
      .join('\n')
      .trim()
  }

  if (Array.isArray(payload?.output)) {
    return payload.output
      .flatMap((item) => item?.content || [])
      .map((item) => item?.text || '')
      .join('\n')
      .trim()
  }

  if (typeof payload?.completion === 'string') {
    return payload.completion
  }

  return ''
}

function extractUsage(payload) {
  const usage = payload?.usage || payload?.message?.usage || {}
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? null
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? null
  const derivedTotal = inputTokens !== null && outputTokens !== null
    ? Number(inputTokens || 0) + Number(outputTokens || 0)
    : null

  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens ?? derivedTotal
  }
}

function mergeUsage(currentUsage, nextUsage) {
  const inputTokens = nextUsage?.inputTokens ?? currentUsage?.inputTokens ?? null
  const outputTokens = nextUsage?.outputTokens ?? currentUsage?.outputTokens ?? null
  const derivedTotal = inputTokens !== null && outputTokens !== null
    ? Number(inputTokens || 0) + Number(outputTokens || 0)
    : null

  return {
    inputTokens,
    outputTokens,
    totalTokens: nextUsage?.totalTokens ?? derivedTotal ?? currentUsage?.totalTokens ?? null
  }
}

function normalizeHostname(baseURL) {
  try {
    return new URL(baseURL).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function shouldPreferJsonResponseFormat({ aiConfig, model } = {}) {
  const hostname = normalizeHostname(aiConfig?.baseURL || '')
  const normalizedModel = String(model || '').trim().toLowerCase()

  return (
    hostname.endsWith('bigmodel.cn')
    || hostname.endsWith('openai.com')
    || hostname.endsWith('siliconflow.cn')
    || hostname.endsWith('api.mimo.ai')
    || hostname.endsWith('xiaomi.com')
    || normalizedModel.startsWith('glm-')
    || normalizedModel.startsWith('gpt-')
    || normalizedModel.startsWith('mimo-')
    || normalizedModel.startsWith('xiaomi/')
    || normalizedModel.includes('/mimo-')
  )
}

function buildRequestBodies({ aiConfig, model, messages, streamResponses } = {}) {
  if (resolveAiProtocol({ aiConfig, model }) === AI_PROTOCOL_ANTHROPIC) {
    return [buildAnthropicRequestBody({ aiConfig, model, messages, streamResponses })]
  }

  const baseBody = {
    model,
    temperature: 0.4,
    messages
  }

  if (streamResponses) {
    baseBody.stream = true
  }

  if (!shouldPreferJsonResponseFormat({ aiConfig, model })) {
    return [baseBody]
  }

  return [
    {
      ...baseBody,
      response_format: {
        type: 'json_object'
      }
    },
    baseBody
  ]
}

function buildTextRequestBody({ aiConfig, model, messages, streamResponses } = {}) {
  if (resolveAiProtocol({ aiConfig, model }) === AI_PROTOCOL_ANTHROPIC) {
    return buildAnthropicRequestBody({ aiConfig, model, messages, streamResponses })
  }

  const body = {
    model,
    temperature: 0.4,
    messages
  }

  if (streamResponses) {
    body.stream = true
  }

  return body
}

function isResponseFormatCompatibilityError(payload, responseText) {
  const joinedText = [
    payload?.error?.message,
    payload?.message,
    responseText
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    joinedText.includes('response_format')
    || joinedText.includes('json_object')
    || joinedText.includes('unsupported')
    || joinedText.includes('invalid parameter')
    || joinedText.includes('unknown parameter')
    || joinedText.includes('not supported')
  )
}

function summarizeRawText(value, maxChars = 240) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ')

  if (!normalized) {
    return ''
  }

  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}...`
    : normalized
}

function looksLikeHtmlErrorPage(value) {
  const normalized = String(value || '').trim().toLowerCase()

  if (!normalized) {
    return false
  }

  return (
    normalized.includes('<html')
    && normalized.includes('<title>')
    && (
      normalized.includes('404 not found')
      || normalized.includes('openresty')
      || normalized.includes('<center><h1>')
    )
  )
}

function createHtmlErrorPageMessage(aiConfig, responseText, statusCode) {
  const baseURL = String(aiConfig?.baseURL || '').trim()
  const suffix = baseURL
    ? ` 当前配置的 AI Base URL 是：${baseURL}`
    : ''

  if (looksLikeHtmlErrorPage(responseText)) {
    return `AI 接口返回了 HTML 错误页（${statusCode}）。这通常表示 AI Base URL 配置错误，应该填写模型服务的 API 根路径，而不是网页地址或错误的完整路径。${suffix}`
  }

  return ''
}

function shouldTreatAsPlainTextFinal(rawText) {
  const normalized = String(rawText || '').trim()

  if (!normalized) {
    return false
  }

  return !normalized.startsWith('{') && !normalized.startsWith('```')
}

function createPlainTextFinalFallback(rawText) {
  let reply = String(rawText || '').trim()
  const fenceMatch = reply.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]+?)\n?```\s*$/)

  if (fenceMatch?.[1]) {
    reply = fenceMatch[1].trim()
  }

  return {
    action: 'final',
    summary: 'Model returned plain-text content; treated as a final reply.',
    reply
  }
}

function unescapeJsonLikeString(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
}

function extractJsonLikeStringField(rawText, fieldName, nextFieldNames = []) {
  const source = String(rawText || '')
  const fieldToken = `"${fieldName}"`
  const startIndex = source.indexOf(fieldToken)

  if (startIndex === -1) {
    return ''
  }

  const colonIndex = source.indexOf(':', startIndex + fieldToken.length)

  if (colonIndex === -1) {
    return ''
  }

  const afterColon = source.slice(colonIndex + 1).trimStart()

  if (!afterColon.startsWith('"')) {
    return ''
  }

  const valueStartIndex = source.length - afterColon.length + 1
  let bestEndIndex = -1

  for (let index = valueStartIndex; index < source.length; index += 1) {
    if (source[index] !== '"') {
      continue
    }

    const remainder = source.slice(index + 1).trimStart()
    const afterComma = remainder.startsWith(',')
      ? remainder.slice(1).trimStart()
      : ''
    const matchesDelimiter =
      remainder.startsWith('}')
      || nextFieldNames.some((name) => afterComma.startsWith(`"${name}"`))

    if (!matchesDelimiter) {
      continue
    }

    bestEndIndex = index
    break
  }

  if (bestEndIndex === -1) {
    return ''
  }

  return unescapeJsonLikeString(source.slice(valueStartIndex, bestEndIndex))
}

function extractJsonLikeStringFieldLoose(rawText, fieldName) {
  const source = String(rawText || '')
  const fieldToken = `"${fieldName}"`
  const startIndex = source.indexOf(fieldToken)

  if (startIndex === -1) {
    return ''
  }

  const colonIndex = source.indexOf(':', startIndex + fieldToken.length)

  if (colonIndex === -1) {
    return ''
  }

  const afterColon = source.slice(colonIndex + 1).trimStart()

  if (!afterColon.startsWith('"')) {
    return ''
  }

  const valueStartIndex = source.length - afterColon.length + 1
  let value = source.slice(valueStartIndex)
  let insideEscape = false
  let bestEndIndex = -1

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]

    if (insideEscape) {
      insideEscape = false
      continue
    }

    if (character === '\\') {
      insideEscape = true
      continue
    }

    if (character !== '"') {
      continue
    }

    const remainder = value.slice(index + 1).trimStart()

    if (!remainder || remainder.startsWith('}') || remainder.startsWith(',')) {
      bestEndIndex = index
      break
    }
  }

  if (bestEndIndex === -1) {
    bestEndIndex = value.lastIndexOf('"')
  }

  if (bestEndIndex >= 0) {
    value = value.slice(0, bestEndIndex)
  }

  return unescapeJsonLikeString(value)
    .replace(/\s*}\s*$/, '')
    .trim()
}

function extractJsonLikeObjectField(rawText, fieldName) {
  const source = String(rawText || '')
  const fieldToken = `"${fieldName}"`
  const startIndex = source.indexOf(fieldToken)

  if (startIndex === -1) {
    return null
  }

  const colonIndex = source.indexOf(':', startIndex + fieldToken.length)

  if (colonIndex === -1) {
    return null
  }

  const objectStartIndex = source.indexOf('{', colonIndex + 1)

  if (objectStartIndex === -1) {
    return null
  }

  let depth = 0
  let insideString = false
  let escaped = false

  for (let index = objectStartIndex; index < source.length; index += 1) {
    const character = source[index]

    if (insideString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (character === '\\') {
        escaped = true
        continue
      }

      if (character === '"') {
        insideString = false
      }

      continue
    }

    if (character === '"') {
      insideString = true
      continue
    }

    if (character === '{') {
      depth += 1
      continue
    }

    if (character === '}') {
      depth -= 1

      if (depth === 0) {
        try {
          return JSON.parse(source.slice(objectStartIndex, index + 1))
        } catch {
          return null
        }
      }
    }
  }

  return null
}

function tryRecoverJsonLikeResponse(rawText) {
  const action = extractJsonLikeStringField(rawText, 'action', ['summary', 'reply', 'question', 'tool'])
    || extractJsonLikeStringField(rawText, 'action', ['thought_summary', 'thoughtSummary', 'summary', 'reply', 'question', 'tool'])
    || extractJsonLikeStringFieldLoose(rawText, 'action')

  if (!action) {
    return null
  }

  if (action === 'final') {
    const thoughtSummary = extractJsonLikeStringField(rawText, 'thought_summary', ['action', 'summary', 'reply', 'question', 'tool'])
      || extractJsonLikeStringField(rawText, 'thoughtSummary', ['action', 'summary', 'reply', 'question', 'tool'])
      || extractJsonLikeStringFieldLoose(rawText, 'thought_summary')
      || extractJsonLikeStringFieldLoose(rawText, 'thoughtSummary')
    const summary = extractJsonLikeStringField(rawText, 'summary', ['reply', 'question', 'tool'])
      || extractJsonLikeStringFieldLoose(rawText, 'summary')

    return {
      action,
      thought_summary: thoughtSummary,
      summary,
      reply: ''
    }
  }

  if (action === 'ask_user') {
    const thoughtSummary = extractJsonLikeStringField(rawText, 'thought_summary', ['action', 'summary', 'question', 'reply', 'tool'])
      || extractJsonLikeStringField(rawText, 'thoughtSummary', ['action', 'summary', 'question', 'reply', 'tool'])
      || extractJsonLikeStringFieldLoose(rawText, 'thought_summary')
      || extractJsonLikeStringFieldLoose(rawText, 'thoughtSummary')
    const summary = extractJsonLikeStringField(rawText, 'summary', ['question', 'reply', 'tool'])
      || extractJsonLikeStringFieldLoose(rawText, 'summary')
    const question = extractJsonLikeStringField(rawText, 'question', ['reply', 'tool', 'summary'])
      || extractJsonLikeStringField(rawText, 'reply', ['tool', 'summary'])
      || extractJsonLikeStringFieldLoose(rawText, 'question')
      || extractJsonLikeStringFieldLoose(rawText, 'reply')

    if (!question) {
      return null
    }

    return {
      action,
      thought_summary: thoughtSummary,
      summary,
      question
    }
  }

  if (action === 'tool') {
    const thoughtSummary = extractJsonLikeStringField(rawText, 'thought_summary', ['action', 'summary', 'tool', 'reply', 'question'])
      || extractJsonLikeStringField(rawText, 'thoughtSummary', ['action', 'summary', 'tool', 'reply', 'question'])
      || extractJsonLikeStringFieldLoose(rawText, 'thought_summary')
      || extractJsonLikeStringFieldLoose(rawText, 'thoughtSummary')
    const summary = extractJsonLikeStringField(rawText, 'summary', ['tool', 'reply', 'question'])
      || extractJsonLikeStringFieldLoose(rawText, 'summary')
    const tool = extractJsonLikeObjectField(rawText, 'tool')

    if (!tool?.name) {
      return null
    }

    return {
      action,
      thought_summary: thoughtSummary,
      summary,
      tool
    }
  }

  return null
}

function extractFirstJsonObject(rawText) {
  const trimmedText = String(rawText || '').trim()

  if (!trimmedText) {
    throw new Error('Model returned an empty response.')
  }

  try {
    return JSON.parse(trimmedText)
  } catch {
    // keep parsing below
  }

  const recoveredFullText = tryRecoverJsonLikeResponse(trimmedText)

  if (recoveredFullText) {
    return recoveredFullText
  }

  const fencedMatch =
    trimmedText.match(/^```json\s*([\s\S]+?)```\s*$/i)
    || trimmedText.match(/^```\s*([\s\S]+?)```\s*$/i)

  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim())
    } catch {
      const recovered = tryRecoverJsonLikeResponse(fencedMatch[1].trim())

      if (recovered) {
        return recovered
      }

      throw new Error('Model response contained malformed JSON.')
    }
  }

  const firstBraceIndex = trimmedText.indexOf('{')

  if (firstBraceIndex === -1) {
    throw new Error('Model response did not contain a JSON object.')
  }

  let depth = 0
  let insideString = false
  let escaped = false

  for (let index = firstBraceIndex; index < trimmedText.length; index += 1) {
    const character = trimmedText[index]

    if (insideString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (character === '\\') {
        escaped = true
        continue
      }

      if (character === '"') {
        insideString = false
      }

      continue
    }

    if (character === '"') {
      insideString = true
      continue
    }

    if (character === '{') {
      depth += 1
      continue
    }

    if (character === '}') {
      depth -= 1

      if (depth === 0) {
        const jsonCandidate = trimmedText.slice(firstBraceIndex, index + 1)

        try {
          return JSON.parse(jsonCandidate)
        } catch {
          const recovered = tryRecoverJsonLikeResponse(jsonCandidate)

          if (recovered) {
            return recovered
          }

          break
        }
      }
    }
  }

  const recovered = tryRecoverJsonLikeResponse(trimmedText)

  if (recovered) {
    return recovered
  }

  throw new Error('Model response contained malformed JSON.')
}

function isTimeoutError(error) {
  const message = normalizeErrorMessage(error)
  return (
    message === 'Model request timed out.'
    || message === 'Model response became idle for too long.'
  )
}

function normalizeErrorMessage(error) {
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : 'Model request failed.'
}

function createIdleTimeoutController(controller, idleTimeoutMs = 0) {
  const normalizedTimeoutMs = Math.max(0, Number(idleTimeoutMs || 0))

  if (!normalizedTimeoutMs) {
    return {
      touch() {},
      stop() {},
      didTimeOut: () => false
    }
  }

  let timeoutId = null
  let idleTimedOut = false

  const schedule = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      idleTimedOut = true
      controller.abort()
    }, normalizedTimeoutMs)
  }

  schedule()

  return {
    touch() {
      schedule()
    },
    stop() {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
    didTimeOut() {
      return idleTimedOut
    }
  }
}

function extractStreamDeltaText(payload) {
  const choice = payload?.choices?.[0]

  if (typeof payload?.delta?.text === 'string') {
    return payload.delta.text
  }

  if (typeof payload?.content_block?.text === 'string') {
    return payload.content_block.text
  }

  if (typeof choice?.delta?.content === 'string') {
    return choice.delta.content
  }

  if (Array.isArray(choice?.delta?.content)) {
    return choice.delta.content
      .map((item) => (
        typeof item?.text === 'string'
          ? item.text
          : typeof item === 'string'
            ? item
            : ''
      ))
      .join('')
  }

  if (typeof choice?.message?.content === 'string') {
    return choice.message.content
  }

  return ''
}

function getResponseTextBody(response) {
  return response.text()
}

async function readStreamedResponseBody(response, {
  controller,
  idleTimeoutMs = 0,
  onTextChunk
} = {}) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()

  if (!response.body || !contentType.includes('text/event-stream')) {
    const rawText = await getResponseTextBody(response)
    let payload = null

    try {
      payload = rawText ? JSON.parse(rawText) : null
    } catch {
      payload = null
    }

    return {
      rawText: extractTextContent(payload),
      usage: extractUsage(payload),
      responseText: rawText,
      payload
    }
  }

  const idleController = createIdleTimeoutController(controller, idleTimeoutMs)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let responseText = ''
  let usage = {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null
  }
  let pendingDataLines = []

  const flushSseEvent = () => {
    if (!pendingDataLines.length) {
      return
    }

    const payloadText = pendingDataLines.join('\n').trim()
    pendingDataLines = []

    if (!payloadText || payloadText === '[DONE]') {
      return
    }

    let payload = null

    try {
      payload = JSON.parse(payloadText)
    } catch {
      return
    }

    const deltaText = extractStreamDeltaText(payload)

    if (deltaText) {
      responseText += deltaText

      if (typeof onTextChunk === 'function') {
        onTextChunk(deltaText, responseText)
      }
    }

    if (payload?.usage || payload?.message?.usage) {
      usage = mergeUsage(usage, extractUsage(payload))
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      idleController.touch()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line) {
          flushSseEvent()
          continue
        }

        if (line.startsWith(':')) {
          continue
        }

        if (line.startsWith('data:')) {
          pendingDataLines.push(line.slice(5).trimStart())
        }
      }
    }

    if (buffer.trim()) {
      const trailingLines = buffer.split(/\r?\n/)

      for (const line of trailingLines) {
        if (line.startsWith('data:')) {
          pendingDataLines.push(line.slice(5).trimStart())
        }
      }
    }

    flushSseEvent()
  } finally {
    idleController.stop()
    reader.releaseLock()
  }

  return {
    rawText: responseText,
    usage,
    responseText,
    payload: null,
    idleTimedOut: idleController.didTimeOut()
  }
}

async function runStructuredCompletionAttempt({
  aiConfig,
  model,
  messages,
  requestTimeoutMs,
  idleTimeoutMs = 0,
  streamResponses = false,
  onTextChunk,
  signal
} = {}) {
  const controller = new AbortController()
  const abortFromCaller = () => {
    controller.abort()
  }
  const timeout = delay(requestTimeoutMs, null, { signal: controller.signal })
    .then(() => {
      controller.abort()
    })
    .catch(() => {})

  if (signal) {
    if (signal.aborted) {
      const cancelledError = new Error('Task was cancelled.')
      cancelledError.code = 'TASK_CANCELLED'
      throw cancelledError
    }

    signal.addEventListener('abort', abortFromCaller, { once: true })
  }

  try {
    const apiProtocol = resolveAiProtocol({ aiConfig, model })
    const requestBodies = buildRequestBodies({
      aiConfig,
      model,
      messages,
      streamResponses
    })
    let lastError = null

    for (let index = 0; index < requestBodies.length; index += 1) {
      const requestBody = requestBodies[index]
      const usedStructuredMode = Boolean(requestBody.response_format)

      const response = await fetch(resolveEndpoint(aiConfig.baseURL, apiProtocol), {
        method: 'POST',
        headers: buildRequestHeaders(aiConfig, apiProtocol, streamResponses),
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })

      const streamedResult = await readStreamedResponseBody(response, {
        controller,
        idleTimeoutMs,
        onTextChunk
      })
      const { rawText, usage, responseText, payload, idleTimedOut } = streamedResult

      if (!response.ok) {
        const htmlErrorMessage = createHtmlErrorPageMessage(aiConfig, responseText, response.status)

        if (htmlErrorMessage) {
          throw new Error(htmlErrorMessage)
        }

        if (
          usedStructuredMode
          && index < requestBodies.length - 1
          && (
            isResponseFormatCompatibilityError(payload, responseText)
            || response.status >= 500
          )
        ) {
          continue
        }

        const errorMessage = payload?.error?.message || responseText || `Model request failed with ${response.status}.`
        throw new Error(errorMessage)
      }

      try {
        return {
          rawText,
          json: extractFirstJsonObject(rawText),
          usage
        }
      } catch (error) {
        lastError = error

        if (shouldTreatAsPlainTextFinal(rawText)) {
          return {
            rawText,
            json: createPlainTextFinalFallback(rawText),
            usage
          }
        }

        if (!usedStructuredMode && index < requestBodies.length - 1) {
          continue
        }

        const details = summarizeRawText(rawText)
        const suffix = details ? ` Raw model output: ${details}` : ''
        throw new Error(`${error.message}${suffix}`)
      } finally {
        if (idleTimedOut) {
          throw new Error('Model response became idle for too long.')
        }
      }
    }

    throw lastError || new Error('Model request failed.')
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (signal?.aborted) {
        const cancelledError = new Error('Task was cancelled.')
        cancelledError.code = 'TASK_CANCELLED'
        throw cancelledError
      }

      throw new Error('Model request timed out.')
    }

    throw error
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortFromCaller)
    }

    controller.abort()
    await timeout
  }
}

export async function createStructuredCompletion({
  aiConfig,
  model,
  messages,
  requestTimeoutMs,
  idleTimeoutMs = 0,
  streamResponses = false,
  timeoutRetries = 0,
  timeoutRetryDelayMs = 0,
  onTextChunk,
  signal
} = {}) {
  let lastError = null
  const maxAttempts = Math.max(1, Number(timeoutRetries || 0) + 1)
  const retryDelayMs = Math.max(0, Number(timeoutRetryDelayMs || 0))

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await runStructuredCompletionAttempt({
        aiConfig,
        model,
        messages,
        requestTimeoutMs,
        idleTimeoutMs,
        streamResponses,
        onTextChunk,
        signal
      })
    } catch (error) {
      if (error?.code === 'TASK_CANCELLED') {
        throw error
      }

      lastError = error
      const shouldRetry = isTimeoutError(error) && attempt < maxAttempts - 1

      if (!shouldRetry) {
        throw error
      }

      if (retryDelayMs > 0) {
        await delay(retryDelayMs * (attempt + 1), null, { signal })
      }
    }
  }

  throw lastError || new Error('Model request failed.')
}

async function runTextCompletionAttempt({
  aiConfig,
  model,
  messages,
  requestTimeoutMs,
  idleTimeoutMs = 0,
  streamResponses = false,
  onTextChunk,
  signal
} = {}) {
  const controller = new AbortController()
  const abortFromCaller = () => {
    controller.abort()
  }
  const timeout = delay(requestTimeoutMs, null, { signal: controller.signal })
    .then(() => {
      controller.abort()
    })
    .catch(() => {})

  if (signal) {
    if (signal.aborted) {
      const cancelledError = new Error('Task was cancelled.')
      cancelledError.code = 'TASK_CANCELLED'
      throw cancelledError
    }

    signal.addEventListener('abort', abortFromCaller, { once: true })
  }

  try {
    const apiProtocol = resolveAiProtocol({ aiConfig, model })
    const response = await fetch(resolveEndpoint(aiConfig.baseURL, apiProtocol), {
      method: 'POST',
      headers: buildRequestHeaders(aiConfig, apiProtocol, streamResponses),
      body: JSON.stringify(buildTextRequestBody({
        aiConfig,
        model,
        messages,
        streamResponses
      })),
      signal: controller.signal
    })

    const streamedResult = await readStreamedResponseBody(response, {
      controller,
      idleTimeoutMs,
      onTextChunk
    })
    const { rawText, usage, responseText, payload, idleTimedOut } = streamedResult

    if (idleTimedOut) {
      throw new Error('Model response became idle for too long.')
    }

    if (!response.ok) {
      const htmlErrorMessage = createHtmlErrorPageMessage(aiConfig, responseText, response.status)

      if (htmlErrorMessage) {
        throw new Error(htmlErrorMessage)
      }

      const errorMessage = payload?.error?.message || responseText || `Model request failed with ${response.status}.`
      throw new Error(errorMessage)
    }

    return {
      rawText,
      text: rawText,
      usage
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (signal?.aborted) {
        const cancelledError = new Error('Task was cancelled.')
        cancelledError.code = 'TASK_CANCELLED'
        throw cancelledError
      }

      throw new Error('Model request timed out.')
    }

    throw error
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortFromCaller)
    }

    controller.abort()
    await timeout
  }
}

export async function createTextCompletion({
  aiConfig,
  model,
  messages,
  requestTimeoutMs,
  idleTimeoutMs = 0,
  streamResponses = false,
  timeoutRetries = 0,
  timeoutRetryDelayMs = 0,
  onTextChunk,
  signal
} = {}) {
  let lastError = null
  const maxAttempts = Math.max(1, Number(timeoutRetries || 0) + 1)
  const retryDelayMs = Math.max(0, Number(timeoutRetryDelayMs || 0))

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await runTextCompletionAttempt({
        aiConfig,
        model,
        messages,
        requestTimeoutMs,
        idleTimeoutMs,
        streamResponses,
        onTextChunk,
        signal
      })
    } catch (error) {
      if (error?.code === 'TASK_CANCELLED') {
        throw error
      }

      lastError = error
      const shouldRetry = isTimeoutError(error) && attempt < maxAttempts - 1

      if (!shouldRetry) {
        throw error
      }

      if (retryDelayMs > 0) {
        await delay(retryDelayMs * (attempt + 1), null, { signal })
      }
    }
  }

  throw lastError || new Error('Model request failed.')
}
