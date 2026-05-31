import { spawn } from 'node:child_process'

function createJsonRpcError(message, code = -32000) {
  const error = new Error(message)
  error.code = code
  return error
}

function truncateText(value, maxChars = 400) {
  const normalized = String(value || '')
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}...`
    : normalized
}

function normalizeHeaderRecord(headers = {}) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [String(key || '').trim(), String(value ?? '').trim()])
      .filter(([key, value]) => Boolean(key) && Boolean(value))
  )
}

function parseSseMessages(rawText) {
  const messages = []
  let eventName = ''
  let dataLines = []

  function commitEvent() {
    const data = dataLines.join('\n').trim()

    if (!data || data === '[DONE]') {
      eventName = ''
      dataLines = []
      return
    }

    try {
      const parsed = JSON.parse(data)
      messages.push({
        event: eventName,
        data: parsed
      })
    } catch {
      messages.push({
        event: eventName,
        data
      })
    }

    eventName = ''
    dataLines = []
  }

  for (const line of String(rawText || '').split(/\r?\n/)) {
    if (!line) {
      commitEvent()
      continue
    }

    if (line.startsWith(':')) {
      continue
    }

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

    if (field === 'event') {
      eventName = value
    } else if (field === 'data') {
      dataLines.push(value)
    }
  }

  commitEvent()

  return messages
}

function selectJsonRpcResponse(messages, expectedId) {
  const normalizedExpectedId = String(expectedId ?? '')
  const messageList = Array.isArray(messages) ? messages : [messages]

  if (!normalizedExpectedId) {
    return messageList.find((message) => message && typeof message === 'object') || null
  }

  return messageList.find((message) => (
    message
    && typeof message === 'object'
    && Object.prototype.hasOwnProperty.call(message, 'id')
    && String(message.id) === normalizedExpectedId
  )) || null
}

function normalizeJsonRpcMessages(parsedValue) {
  if (Array.isArray(parsedValue)) {
    return parsedValue
  }

  return parsedValue ? [parsedValue] : []
}

function parseSseData(eventName, dataLines) {
  const data = dataLines.join('\n').trim()

  if (!data || data === '[DONE]') {
    return null
  }

  try {
    return {
      event: eventName,
      data: JSON.parse(data)
    }
  } catch {
    return {
      event: eventName,
      data
    }
  }
}

async function readStreamingSseJsonRpcResponse(response, expectedId) {
  const reader = response.body?.getReader?.()

  if (!reader) {
    const rawText = await response.text()
    return selectJsonRpcResponse(
      parseSseMessages(rawText).map((item) => item.data),
      expectedId
    )
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines = []

  function commitEvent() {
    const parsedEvent = parseSseData(eventName, dataLines)

    eventName = ''
    dataLines = []

    if (!parsedEvent) {
      return null
    }

    return selectJsonRpcResponse([parsedEvent.data], expectedId)
  }

  function processLine(line) {
    if (!line) {
      return commitEvent()
    }

    if (line.startsWith(':')) {
      return null
    }

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

    if (field === 'event') {
      eventName = value
    } else if (field === 'data') {
      dataLines.push(value)
    }

    return null
  }

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        buffer += decoder.decode()

        if (buffer) {
          const matched = processLine(buffer)

          if (matched) {
            return matched
          }
        }

        return commitEvent()
      }

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''

      for (const line of lines) {
        const matched = processLine(line)

        if (matched) {
          await reader.cancel().catch(() => {})
          return matched
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

async function readHttpJsonRpcResponse(response, expectedId) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()

  if (contentType.includes('text/event-stream')) {
    return readStreamingSseJsonRpcResponse(response, expectedId)
  }

  const rawText = await response.text()
  const normalizedText = rawText.trim()

  if (!normalizedText) {
    return null
  }

  if (normalizedText.startsWith('event:') || normalizedText.startsWith('data:')) {
    return selectJsonRpcResponse(
      parseSseMessages(normalizedText).map((item) => item.data),
      expectedId
    )
  }

  const parsedValue = JSON.parse(normalizedText)

  return selectJsonRpcResponse(normalizeJsonRpcMessages(parsedValue), expectedId)
}

function createAbortError(message, code = 'TASK_CANCELLED') {
  const error = new Error(message)
  error.code = code
  return error
}

export class StdioMcpClient {
  constructor({
    command,
    args = [],
    cwd,
    env,
    timeoutMs = 30000,
    protocolVersion = '2025-11-25',
    clientInfo = {
      name: 'agent-api',
      version: '0.1.0'
    }
  } = {}) {
    this.command = command
    this.args = Array.isArray(args) ? args.map((item) => String(item ?? '')).filter(Boolean) : []
    this.cwd = cwd
    this.env = env
    this.timeoutMs = timeoutMs
    this.protocolVersion = protocolVersion
    this.clientInfo = clientInfo
    this.child = null
    this.buffer = ''
    this.nextRequestId = 1
    this.pendingRequests = new Map()
    this.started = false
    this.closed = false
  }

  async start() {
    if (this.started) {
      return
    }

    if (!this.command) {
      throw new Error('MCP stdio client requires a command.')
    }

    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      shell: false,
      windowsHide: true
    })

    this.child.stdout.on('data', (chunk) => {
      this.handleStdout(chunk.toString('utf8'))
    })

    this.child.stderr.on('data', (chunk) => {
      const nextValue = truncateText(chunk.toString('utf8'))

      if (nextValue.trim()) {
        console.warn(`[mcp] stderr from ${this.command}: ${nextValue}`)
      }
    })

    this.child.on('error', (error) => {
      this.rejectAllPending(error instanceof Error ? error : new Error('MCP process error.'))
    })

    this.child.on('close', (code, signal) => {
      const message = `MCP process exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}.`
      this.closed = true
      this.rejectAllPending(createJsonRpcError(message))
    })

    const initializeResult = await this.request('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: this.clientInfo
    })

    const negotiatedProtocol = String(initializeResult?.protocolVersion || '').trim()

    if (negotiatedProtocol) {
      this.protocolVersion = negotiatedProtocol
    }

    await this.notify('notifications/initialized', {})
    this.started = true
  }

  handleStdout(chunk) {
    this.buffer += chunk

    while (true) {
      const newlineIndex = this.buffer.indexOf('\n')

      if (newlineIndex === -1) {
        break
      }

      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (!line) {
        continue
      }

      try {
        const message = JSON.parse(line)
        this.handleMessage(message)
      } catch (error) {
        console.warn('[mcp] failed to parse stdio message:', error instanceof Error ? error.message : error)
      }
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return
    }

    if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
      return
    }

    const pending = this.pendingRequests.get(String(message.id))

    if (!pending) {
      return
    }

    this.pendingRequests.delete(String(message.id))
    clearTimeout(pending.timeoutId)
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener)
    }

    if (message.error) {
      pending.reject(
        createJsonRpcError(
          typeof message.error.message === 'string'
            ? message.error.message
            : 'MCP request failed.',
          Number.isInteger(message.error.code) ? message.error.code : -32000
        )
      )
      return
    }

    pending.resolve(message.result)
  }

  rejectAllPending(error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId)
      if (pending.signal && pending.abortListener) {
        pending.signal.removeEventListener('abort', pending.abortListener)
      }
      pending.reject(error)
    }

    this.pendingRequests.clear()
  }

  async request(method, params = {}, { signal } = {}) {
    if (!this.child?.stdin || this.closed) {
      throw new Error('MCP client is not available.')
    }

    if (signal?.aborted) {
      const error = new Error(`MCP request was cancelled: ${method}`)
      error.code = 'TASK_CANCELLED'
      throw error
    }

    const id = this.nextRequestId++
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(String(id))
        reject(new Error(`MCP request timed out: ${method}`))
      }, this.timeoutMs)
      const abortListener = () => {
        clearTimeout(timeoutId)
        this.pendingRequests.delete(String(id))
        const error = new Error(`MCP request was cancelled: ${method}`)
        error.code = 'TASK_CANCELLED'
        reject(error)
      }

      this.pendingRequests.set(String(id), {
        resolve,
        reject,
        timeoutId,
        signal,
        abortListener
      })

      if (signal) {
        signal.addEventListener('abort', abortListener, { once: true })
      }

      this.child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8', (error) => {
        if (signal) {
          signal.removeEventListener('abort', abortListener)
        }

        if (!error) {
          return
        }

        clearTimeout(timeoutId)
        this.pendingRequests.delete(String(id))
        reject(error)
      })
    })
  }

  async notify(method, params = {}) {
    if (!this.child?.stdin || this.closed) {
      throw new Error('MCP client is not available.')
    }

    const payload = {
      jsonrpc: '2.0',
      method,
      params
    }

    return new Promise((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8', (error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  async listTools() {
    const tools = []
    let cursor = ''

    while (true) {
      const result = await this.request('tools/list', cursor ? { cursor } : {})
      const nextTools = Array.isArray(result?.tools) ? result.tools : []

      tools.push(...nextTools)

      cursor = String(result?.nextCursor || '').trim()

      if (!cursor) {
        break
      }
    }

    return tools
  }

  async callTool(name, args = {}, { signal } = {}) {
    return this.request('tools/call', {
      name,
      arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {}
    }, {
      signal
    })
  }

  async close() {
    this.closed = true

    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM')
    }
  }
}

export class HttpMcpClient {
  constructor({
    url,
    headers = {},
    timeoutMs = 30000,
    protocolVersion = '2025-11-25',
    closeSessionOnClose = true,
    clientInfo = {
      name: 'agent-api',
      version: '0.1.0'
    }
  } = {}) {
    this.url = String(url || '').trim()
    this.headers = normalizeHeaderRecord(headers)
    this.timeoutMs = timeoutMs
    this.protocolVersion = protocolVersion
    this.closeSessionOnClose = closeSessionOnClose !== false
    this.clientInfo = clientInfo
    this.nextRequestId = 1
    this.started = false
    this.closed = false
    this.sessionId = ''
  }

  async start() {
    if (this.started) {
      return
    }

    if (!this.url) {
      throw new Error('MCP HTTP client requires a URL.')
    }

    const initializeResult = await this.request('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: this.clientInfo
    })

    const negotiatedProtocol = String(initializeResult?.protocolVersion || '').trim()

    if (negotiatedProtocol) {
      this.protocolVersion = negotiatedProtocol
    }

    await this.notify('notifications/initialized', {})
    this.started = true
  }

  createHeaders() {
    const headers = new Headers({
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...this.headers
    })

    if (this.protocolVersion) {
      headers.set('MCP-Protocol-Version', this.protocolVersion)
    }

    if (this.sessionId) {
      headers.set('Mcp-Session-Id', this.sessionId)
    }

    return headers
  }

  async postJsonRpc(payload, {
    signal,
    expectResponse = true,
    methodLabel = ''
  } = {}) {
    if (this.closed) {
      throw new Error('MCP client is not available.')
    }

    if (signal?.aborted) {
      throw createAbortError(`MCP request was cancelled: ${methodLabel || payload?.method || 'request'}`)
    }

    const controller = new AbortController()
    let timeoutTriggered = false
    const timeoutId = setTimeout(() => {
      timeoutTriggered = true
      controller.abort()
    }, this.timeoutMs)
    const abortListener = () => {
      controller.abort()
    }

    if (signal) {
      signal.addEventListener('abort', abortListener, { once: true })
    }

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.createHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal
      })

      const nextSessionId = String(response.headers.get('mcp-session-id') || '').trim()

      if (nextSessionId) {
        this.sessionId = nextSessionId
      }

      if (!response.ok) {
        const rawText = await response.text().catch(() => '')
        throw createJsonRpcError(
          `MCP HTTP request failed: ${response.status} ${response.statusText}${rawText.trim() ? ` - ${truncateText(rawText, 800)}` : ''}`,
          response.status
        )
      }

      if (!expectResponse) {
        await response.text().catch(() => '')
        return null
      }

      const responseMessage = await readHttpJsonRpcResponse(response, payload.id)

      if (!responseMessage) {
        throw createJsonRpcError(`MCP HTTP response did not include a JSON-RPC result for ${methodLabel || payload?.method || 'request'}.`)
      }

      if (responseMessage.error) {
        throw createJsonRpcError(
          typeof responseMessage.error.message === 'string'
            ? responseMessage.error.message
            : 'MCP request failed.',
          Number.isInteger(responseMessage.error.code) ? responseMessage.error.code : -32000
        )
      }

      return responseMessage.result
    } catch (error) {
      if (timeoutTriggered) {
        throw new Error(`MCP request timed out: ${methodLabel || payload?.method || 'request'}`)
      }

      if (signal?.aborted) {
        throw createAbortError(`MCP request was cancelled: ${methodLabel || payload?.method || 'request'}`)
      }

      throw error
    } finally {
      clearTimeout(timeoutId)

      if (signal) {
        signal.removeEventListener('abort', abortListener)
      }
    }
  }

  async request(method, params = {}, { signal } = {}) {
    const id = this.nextRequestId++
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    return this.postJsonRpc(payload, {
      signal,
      expectResponse: true,
      methodLabel: method
    })
  }

  async notify(method, params = {}) {
    const payload = {
      jsonrpc: '2.0',
      method,
      params
    }

    await this.postJsonRpc(payload, {
      expectResponse: false,
      methodLabel: method
    })
  }

  async listTools() {
    const tools = []
    let cursor = ''

    while (true) {
      const result = await this.request('tools/list', cursor ? { cursor } : {})
      const nextTools = Array.isArray(result?.tools) ? result.tools : []

      tools.push(...nextTools)

      cursor = String(result?.nextCursor || '').trim()

      if (!cursor) {
        break
      }
    }

    return tools
  }

  async callTool(name, args = {}, { signal } = {}) {
    return this.request('tools/call', {
      name,
      arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {}
    }, {
      signal
    })
  }

  async close() {
    this.closed = true

    if (!this.closeSessionOnClose || !this.sessionId || !this.url) {
      return
    }

    try {
      await fetch(this.url, {
        method: 'DELETE',
        headers: this.createHeaders()
      })
    } catch {
      // Ignore close errors; the server may not implement session deletion.
    }
  }
}
