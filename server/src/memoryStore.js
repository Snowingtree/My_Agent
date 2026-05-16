import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { normalizeTrimmedString, nowIso } from './utils.js'

const DEFAULT_PROFILE_FILE = 'user_profile.md'
const DEFAULT_MAX_PROFILE_CHARS = 8000
const SENSITIVE_LINE_PATTERN = /(api[-_ ]?key|authorization|password|secret|token|access[-_ ]?token|refresh[-_ ]?token|cookie|credential|密钥|密码|令牌)/i

function normalizeMaxChars(value) {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_MAX_PROFILE_CHARS
}

function sanitizeProfileText(value, maxChars = DEFAULT_MAX_PROFILE_CHARS) {
  const normalized = normalizeTrimmedString(value)

  if (!normalized) {
    return ''
  }

  const safeLines = normalized
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !SENSITIVE_LINE_PATTERN.test(line))
    .join('\n')
    .trim()

  return safeLines.length > maxChars
    ? safeLines.slice(0, maxChars).trim()
    : safeLines
}

export class MemoryStore {
  constructor({
    memoryDir,
    profileFile = DEFAULT_PROFILE_FILE,
    maxProfileChars = DEFAULT_MAX_PROFILE_CHARS
  } = {}) {
    this.memoryDir = normalizeTrimmedString(memoryDir)
    this.profileFile = normalizeTrimmedString(profileFile) || DEFAULT_PROFILE_FILE
    this.maxProfileChars = normalizeMaxChars(maxProfileChars)
    this.profilePath = this.memoryDir ? join(this.memoryDir, this.profileFile) : ''
    this.pendingWrite = Promise.resolve()
  }

  async ensure() {
    if (!this.profilePath) {
      return
    }

    await mkdir(dirname(this.profilePath), { recursive: true })
  }

  async readUserProfile() {
    if (!this.profilePath) {
      return ''
    }

    try {
      const content = await readFile(this.profilePath, 'utf8')
      return sanitizeProfileText(content, this.maxProfileChars)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return ''
      }

      throw error
    }
  }

  async writeUserProfile(content, metadata = {}) {
    if (!this.profilePath) {
      return {
        ok: false,
        profile: '',
        updatedAt: null,
        reason: 'memory_store_disabled'
      }
    }

    const nextProfile = sanitizeProfileText(content, this.maxProfileChars)
    const updatedAt = nowIso()

    this.pendingWrite = this.pendingWrite.then(async () => {
      await this.ensure()
      await writeFile(this.profilePath, `${nextProfile}\n`, 'utf8')
    })

    await this.pendingWrite

    return {
      ok: true,
      profile: nextProfile,
      updatedAt,
      profilePath: this.profilePath,
      reason: normalizeTrimmedString(metadata?.reason)
    }
  }

  async getStatus() {
    const profile = await this.readUserProfile()

    return {
      enabled: Boolean(this.profilePath),
      profilePath: this.profilePath,
      maxProfileChars: this.maxProfileChars,
      hasProfile: Boolean(profile),
      profileChars: profile.length
    }
  }
}

export function createMemoryStore(options = {}) {
  return new MemoryStore(options)
}
