import { setTimeout as delay } from 'node:timers/promises'

function resolveEndpoint(baseURL) {
  if (baseURL.endsWith('/chat/completions')) {
    return baseURL
  }

  return `${baseURL}/chat/completions`
}

function extractTextContent(payload) {
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

  return ''
}

function extractUsage(payload) {
  return {
    inputTokens: payload?.usage?.prompt_tokens ?? null,
    outputTokens: payload?.usage?.completion_tokens ?? null,
    totalTokens: payload?.usage?.total_tokens ?? null
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
    return `AI 接口返回了 HTML 错误页（${statusCode}）。这通常表示 AI Base URL 配置错误，应该填写 OpenAI 兼容接口根路径，而不是网页地址或错误的完整路径。${suffix}`
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
  const delimiters = [
    ...nextFieldNames.map((name) => `,"${name}"`),
    '}'
  ]
  let bestEndIndex = -1

  for (let index = valueStartIndex; index < source.length; index += 1) {
    if (source[index] !== '"') {
      continue
    }

    const remainder = source.slice(index + 1).trimStart()
    const matchesDelimiter = delimiters.some((delimiter) => remainder.startsWith(delimiter))

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

  if (!action) {
    return null
  }

  if (action === 'final') {
    const summary = extractJsonLikeStringField(rawText, 'summary', ['reply', 'question', 'tool'])
    const reply = extractJsonLikeStringField(rawText, 'reply', ['question', 'tool', 'summary'])

    if (!reply) {
      return null
    }

    return {
      action,
      summary,
      reply
    }
  }

  if (action === 'ask_user') {
    const summary = extractJsonLikeStringField(rawText, 'summary', ['question', 'reply', 'tool'])
    const question = extractJsonLikeStringField(rawText, 'question', ['reply', 'tool', 'summary'])
      || extractJsonLikeStringField(rawText, 'reply', ['tool', 'summary'])

    if (!question) {
      return null
    }

    return {
      action,
      summary,
      question
    }
  }

  if (action === 'tool') {
    const summary = extractJsonLikeStringField(rawText, 'summary', ['tool', 'reply', 'question'])
    const tool = extractJsonLikeObjectField(rawText, 'tool')

    if (!tool?.name) {
      return null
    }

    return {
      action,
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

  const fencedMatch = trimmedText.match(/```json\s*([\s\S]+?)```/i) || trimmedText.match(/```\s*([\s\S]+?)```/i)

  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim())
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
        return JSON.parse(trimmedText.slice(firstBraceIndex, index + 1))
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

    if (payload?.usage) {
      usage = extractUsage(payload)
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

      const response = await fetch(resolveEndpoint(aiConfig.baseURL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: streamResponses ? 'text/event-stream, application/json' : 'application/json',
          Authorization: `Bearer ${aiConfig.apiKey}`
        },
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
          && isResponseFormatCompatibilityError(payload, responseText)
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
