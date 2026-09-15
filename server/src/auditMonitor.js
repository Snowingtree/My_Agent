import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadEnvFiles } from './env.js'
import { createConfig } from './config.js'
import { AUDIT_EVENT_CATEGORIES } from './auditLogger.js'

loadEnvFiles()

const config = createConfig()
const requestedSessionId = String(process.argv[2] || '').trim()
const safeRequestedSessionId = requestedSessionId.replace(/[^a-zA-Z0-9_.-]/g, '_')
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const colors = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  llm_input: '\u001b[36m',
  tool_call: '\u001b[33m',
  tool_result: '\u001b[32m',
  ai_message: '\u001b[35m',
  system_action: '\u001b[90m'
}
const seenLines = new Map()
let stopped = false

function colorize(category, value) {
  if (!useColor) {
    return value
  }

  return `${colors[category] || colors.system_action}${value}${colors.reset}`
}

function shortText(value, maxLength = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function eventSummary(event) {
  return shortText(
    event?.summary
      || event?.message
      || event?.contentPreview
      || event?.resultPreview
      || event?.action
      || event?.tool
      || event?.event
      || ''
  )
}

function printHeader() {
  console.log('CyberClaw-style Agent audit monitor')
  console.log(`audit dir: ${config.storage.auditDir}`)
  console.log(`categories: ${AUDIT_EVENT_CATEGORIES.join(' | ')}`)
  console.log('press Ctrl+C to stop\n')
}

function printEvent(event, sessionId) {
  const category = AUDIT_EVENT_CATEGORIES.includes(event?.category)
    ? event.category
    : 'system_action'
  const timestamp = new Date(event?.ts || Date.now()).toLocaleTimeString()
  const sessionLabel = shortText(sessionId, 24)
  const detail = eventSummary(event)
  const originalEvent = event?.event && event.event !== category ? ` ${event.event}` : ''
  const line = `[${timestamp}] [${category}]${originalEvent} ${sessionLabel}${detail ? ` - ${detail}` : ''}`
  console.log(colorize(category, line))
}

async function pollAuditFiles() {
  let entries = []

  try {
    entries = await readdir(config.storage.auditDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[audit-monitor] ${error instanceof Error ? error.message : error}`)
    }
    return
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue
    }

    const sessionId = basename(entry.name, '.jsonl')

    if (safeRequestedSessionId && sessionId !== safeRequestedSessionId) {
      continue
    }

    const filePath = join(config.storage.auditDir, entry.name)

    try {
      const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean)
      const previousCount = seenLines.get(filePath) ?? 0
      const startIndex = previousCount === 0 ? Math.max(0, lines.length - 20) : previousCount

      for (const line of lines.slice(startIndex)) {
        try {
          printEvent(JSON.parse(line), sessionId)
        } catch {
          console.warn(`[audit-monitor] malformed JSON in ${entry.name}`)
        }
      }

      seenLines.set(filePath, lines.length)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error(`[audit-monitor] failed to read ${entry.name}: ${error instanceof Error ? error.message : error}`)
      }
    }
  }
}

async function main() {
  printHeader()
  await pollAuditFiles()

  const timer = setInterval(() => {
    void pollAuditFiles()
  }, 500)

  const stop = () => {
    if (stopped) {
      return
    }

    stopped = true
    clearInterval(timer)
    console.log('\n[audit-monitor] stopped')
    process.exit(0)
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

await main()
