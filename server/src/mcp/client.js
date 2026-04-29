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
