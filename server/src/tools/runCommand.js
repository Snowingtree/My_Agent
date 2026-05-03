import { spawn } from 'node:child_process'

function normalizeArgList(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => String(item ?? '')).filter((item) => item.length > 0)
}

function appendOutput(current, nextChunk, maxChars) {
  const nextValue = `${current}${nextChunk}`

  if (nextValue.length <= maxChars) {
    return {
      value: nextValue,
      truncated: false
    }
  }

  return {
    value: nextValue.slice(0, maxChars),
    truncated: true
  }
}

function truncatePreview(value, maxChars = 1200) {
  const normalized = String(value || '').trim()
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}\n...truncated...`
    : normalized
}

export function createRunCommandTool({ workspace, workspaceConfig, runtimeConfig } = {}) {
  return {
    name: 'run_command',
    description: '在工作区内执行允许的命令。适用于构建、测试、代码检查和仓库查看等命令。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '命令名称，必须在服务器允许列表中。' },
        args: { type: 'array', description: '命令参数，字符串数组。' },
        cwd: { type: 'string', description: '工作区内的相对工作目录。默认为 "."。' }
      },
      required: ['command']
    },
    async run(args = {}, executionContext = {}) {
      const command = String(args.command || '').trim()
      const signal = executionContext.signal
      const onProgress = typeof executionContext.onProgress === 'function'
        ? executionContext.onProgress
        : null

      if (!command) {
        throw new Error('run_command requires a command.')
      }

      if (signal?.aborted) {
        const error = new Error('Command execution was cancelled.')
        error.code = 'TASK_CANCELLED'
        throw error
      }

      if (!workspaceConfig.allowedCommands.includes(command)) {
        throw new Error(`Command "${command}" is not allowed.`)
      }

      const commandArgs = normalizeArgList(args.args)
      const cwd = workspace.resolvePath(args.cwd || '.')
      const timeoutMs = runtimeConfig.commandTimeoutMs

      return new Promise((resolve, reject) => {
        let stdout = ''
        let stderr = ''
        let stdoutTruncated = false
        let stderrTruncated = false
        let settled = false
        let didTimeout = false
        let didCancel = false
        let child

        try {
          child = spawn(command, commandArgs, {
            cwd: cwd.absolutePath,
            shell: false,
            windowsHide: true
          })
        } catch (error) {
          if (error?.code === 'ENOENT') {
            reject(new Error(`Command "${command}" was not found on the server.`))
            return
          }

          if (error?.code === 'EPERM') {
            reject(new Error(`Command "${command}" could not be started because process execution is blocked by the current server environment.`))
            return
          }

          reject(error)
          return
        }

        const timeoutId = setTimeout(() => {
          didTimeout = true
          child.kill('SIGTERM')
        }, timeoutMs)
        const abortListener = () => {
          if (settled) {
            return
          }

          didCancel = true
          settled = true
          clearTimeout(timeoutId)
          child.kill('SIGTERM')
          const error = new Error('Command execution was cancelled.')
          error.code = 'TASK_CANCELLED'
          reject(error)
        }

        if (signal) {
          signal.addEventListener('abort', abortListener, { once: true })
        }

        child.stdout.on('data', (chunk) => {
          const nextState = appendOutput(stdout, chunk.toString('utf8'), workspaceConfig.maxCommandOutputChars)
          stdout = nextState.value
          stdoutTruncated = stdoutTruncated || nextState.truncated
          onProgress?.({
            stream: 'stdout',
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated
          })
        })

        child.stderr.on('data', (chunk) => {
          const nextState = appendOutput(stderr, chunk.toString('utf8'), workspaceConfig.maxCommandOutputChars)
          stderr = nextState.value
          stderrTruncated = stderrTruncated || nextState.truncated
          onProgress?.({
            stream: 'stderr',
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated
          })
        })

        child.on('error', (error) => {
          if (settled) {
            return
          }

          settled = true
          clearTimeout(timeoutId)
          if (signal) {
            signal.removeEventListener('abort', abortListener)
          }

          if (error?.code === 'ENOENT') {
            reject(new Error(`Command "${command}" was not found on the server.`))
            return
          }

          if (error?.code === 'EPERM') {
            reject(new Error(`Command "${command}" could not be started because process execution is blocked by the current server environment.`))
            return
          }

          reject(error)
        })

        child.on('close', (exitCode, signal) => {
          if (settled) {
            return
          }

          settled = true
          clearTimeout(timeoutId)
          if (signal) {
            signal.removeEventListener('abort', abortListener)
          }

          if (didCancel) {
            return
          }

          resolve({
            command,
            args: commandArgs,
            cwd: cwd.relativePath,
            exitCode: Number.isInteger(exitCode) ? exitCode : null,
            signal: signal || '',
            timedOut: didTimeout,
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated
          })
        })
      })
    },
    summarize(result) {
      const status = result.exitCode === 0 ? 'succeeded' : `finished with exit code ${result.exitCode ?? 'unknown'}`
      return `Command ${result.command} ${status} in ${result.cwd}.`
    },
    formatMessage(result) {
      const commandLine = [result.command, ...(Array.isArray(result.args) ? result.args : [])].join(' ')
      const output = truncatePreview(result.stdout || result.stderr || '')

      return [
        'Tool: run_command',
        `Command: ${commandLine}`,
        `Working directory: ${result.cwd}`,
        `Exit code: ${result.exitCode ?? 'unknown'}${result.timedOut ? ' (timed out)' : ''}`,
        '',
        'Output:',
        output || '(no output)'
      ].join('\n')
    }
  }
}
