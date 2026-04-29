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
    || normalizedModel.startsWith('glm-')
    || normalizedModel.startsWith('gpt-')
  )
}

function buildRequestBodies({ aiConfig, model, messages } = {}) {
  const baseBody = {
    model,
    temperature: 0.4,
    messages
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

function shouldTreatAsPlainTextFinal(rawText) {
  const normalized = String(rawText || '').trim()

  if (!normalized) {
    return false
  }

  return !normalized.startsWith('{') && !normalized.startsWith('```')
}

function createPlainTextFinalFallback(rawText) {
  const reply = String(rawText || '').trim()

  return {
    action: 'final',
    summary: 'Model returned plain-text content; treated as a final reply.',
    reply
  }
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

  throw new Error('Model response contained malformed JSON.')
}

function isTimeoutError(error) {
  return normalizeErrorMessage(error) === 'Model request timed out.'
}

function normalizeErrorMessage(error) {
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : 'Model request failed.'
}

async function runStructuredCompletionAttempt({
  aiConfig,
  model,
  messages,
  requestTimeoutMs,
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
      messages
    })
    let lastError = null

    for (let index = 0; index < requestBodies.length; index += 1) {
      const requestBody = requestBodies[index]
      const usedStructuredMode = Boolean(requestBody.response_format)

      const response = await fetch(resolveEndpoint(aiConfig.baseURL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${aiConfig.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })

      const responseText = await response.text()
      let payload = null

      try {
        payload = responseText ? JSON.parse(responseText) : null
      } catch {
        payload = null
      }

      if (!response.ok) {
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

      const content = extractTextContent(payload)
      const usage = extractUsage(payload)

      try {
        return {
          rawText: content,
          json: extractFirstJsonObject(content),
          usage
        }
      } catch (error) {
        lastError = error

        if (shouldTreatAsPlainTextFinal(content)) {
          return {
            rawText: content,
            json: createPlainTextFinalFallback(content),
            usage
          }
        }

        if (!usedStructuredMode && index < requestBodies.length - 1) {
          continue
        }

        const details = summarizeRawText(content)
        const suffix = details ? ` Raw model output: ${details}` : ''
        throw new Error(`${error.message}${suffix}`)
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
  timeoutRetries = 0,
  timeoutRetryDelayMs = 0,
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
