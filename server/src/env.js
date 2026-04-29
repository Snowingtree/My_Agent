import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url))

export const SERVER_ROOT = resolve(CURRENT_DIR, '..')

function parseEnvLine(line) {
  const trimmedLine = line.trim()

  if (!trimmedLine || trimmedLine.startsWith('#')) {
    return null
  }

  const separatorIndex = trimmedLine.indexOf('=')

  if (separatorIndex === -1) {
    return null
  }

  const key = trimmedLine.slice(0, separatorIndex).trim()
  let value = trimmedLine.slice(separatorIndex + 1).trim()

  if (!key) {
    return null
  }

  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return { key, value }
}

export function loadEnvFiles() {
  const envPaths = [
    resolve(SERVER_ROOT, '.env.local'),
    resolve(SERVER_ROOT, '.env')
  ]

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue
    }

    const content = readFileSync(envPath, 'utf8')
    const lines = content.split(/\r?\n/)

    for (const line of lines) {
      const parsed = parseEnvLine(line)

      if (!parsed || parsed.key in process.env) {
        continue
      }

      process.env[parsed.key] = parsed.value
    }
  }
}
