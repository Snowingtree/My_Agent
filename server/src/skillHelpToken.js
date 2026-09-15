import { createHash, randomBytes } from 'node:crypto'
import { normalizeTrimmedString } from './utils.js'

export const DEFAULT_SKILL_HELP_TOKEN_TTL_MS = 300000

function normalizeTtl(value) {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_SKILL_HELP_TOKEN_TTL_MS
}

export function hashSkillInstruction(instruction) {
  return createHash('sha256')
    .update(String(instruction || ''), 'utf8')
    .digest('hex')
}

export function issueSkillHelpToken({
  threadId,
  skillId,
  instruction,
  ttlMs = DEFAULT_SKILL_HELP_TOKEN_TTL_MS,
  now = Date.now()
} = {}) {
  const issuedAtMs = Number(now)
  const expiresAtMs = issuedAtMs + normalizeTtl(ttlMs)

  return {
    token: randomBytes(32).toString('base64url'),
    threadId: normalizeTrimmedString(threadId),
    skillId: normalizeTrimmedString(skillId),
    instructionHash: hashSkillInstruction(instruction),
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    consumedAt: null
  }
}

export function validateSkillHelpToken(record, {
  token,
  threadId,
  skillId,
  instruction,
  now = Date.now()
} = {}) {
  if (!record?.token) {
    return { ok: false, reason: 'help_token_required' }
  }

  if (normalizeTrimmedString(token) !== normalizeTrimmedString(record.token)) {
    return { ok: false, reason: 'help_token_invalid' }
  }

  if (record.consumedAt) {
    return { ok: false, reason: 'help_token_replayed' }
  }

  if (normalizeTrimmedString(record.threadId) !== normalizeTrimmedString(threadId)) {
    return { ok: false, reason: 'help_token_wrong_thread' }
  }

  if (normalizeTrimmedString(record.skillId) !== normalizeTrimmedString(skillId)) {
    return { ok: false, reason: 'help_token_wrong_skill' }
  }

  if (record.instructionHash !== hashSkillInstruction(instruction)) {
    return { ok: false, reason: 'help_token_stale_instruction' }
  }

  if (Number(now) >= Number(record.expiresAtMs)) {
    return { ok: false, reason: 'help_token_expired' }
  }

  return { ok: true }
}

export function consumeSkillHelpToken(record, now = Date.now()) {
  if (record && !record.consumedAt) {
    record.consumedAt = new Date(Number(now)).toISOString()
  }

  return record
}
