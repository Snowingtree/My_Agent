import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeSkillHelpToken,
  issueSkillHelpToken,
  validateSkillHelpToken
} from '../src/skillHelpToken.js'

function validOptions(tokenRecord, overrides = {}) {
  return {
    token: tokenRecord.token,
    threadId: 'session-1',
    skillId: 'frontend',
    instruction: 'Use the frontend workflow.',
    now: 1_000,
    ...overrides
  }
}

test('skill help token is bound to the thread, skill, and instruction version', () => {
  const tokenRecord = issueSkillHelpToken({
    threadId: 'session-1',
    skillId: 'frontend',
    instruction: 'Use the frontend workflow.',
    ttlMs: 300_000,
    now: 1_000
  })

  assert.equal(validateSkillHelpToken(tokenRecord, validOptions(tokenRecord)).ok, true)
  assert.equal(validateSkillHelpToken(tokenRecord, validOptions(tokenRecord, { threadId: 'session-2' })).reason, 'help_token_wrong_thread')
  assert.equal(validateSkillHelpToken(tokenRecord, validOptions(tokenRecord, { skillId: 'backend' })).reason, 'help_token_wrong_skill')
  assert.equal(validateSkillHelpToken(tokenRecord, validOptions(tokenRecord, { instruction: 'Changed workflow.' })).reason, 'help_token_stale_instruction')
})

test('skill help token expires and can only be consumed once', () => {
  const tokenRecord = issueSkillHelpToken({
    threadId: 'session-1',
    skillId: 'frontend',
    instruction: 'Use the frontend workflow.',
    ttlMs: 100,
    now: 1_000
  })

  assert.equal(validateSkillHelpToken(tokenRecord, validOptions(tokenRecord, { now: 1_099 })).ok, true)
  assert.equal(validateSkillHelpToken(tokenRecord, validOptions(tokenRecord, { now: 1_100 })).reason, 'help_token_expired')

  const freshTokenRecord = issueSkillHelpToken({
    threadId: 'session-1',
    skillId: 'frontend',
    instruction: 'Use the frontend workflow.',
    now: 1_000
  })
  consumeSkillHelpToken(freshTokenRecord, 1_001)

  assert.equal(validateSkillHelpToken(freshTokenRecord, validOptions(freshTokenRecord, { now: 1_002 })).reason, 'help_token_replayed')
})
