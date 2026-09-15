import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { AUDIT_EVENT_CATEGORIES, createAuditLogger } from '../src/auditLogger.js'

test('audit logger writes five CyberClaw categories through JSONL', async () => {
  const auditDir = await mkdtemp(join(tmpdir(), 'agent-audit-'))
  const logger = createAuditLogger({
    auditDir,
    flushIntervalMs: 100000,
    batchSize: 100
  })

  for (const event of [
    'llm_input',
    'tool_call',
    'tool_result',
    'ai_message',
    'system_action'
  ]) {
    logger.logEvent({
      sessionId: 'session-1',
      event
    })
  }

  logger.logEvent({
    sessionId: 'session-1',
    event: 'mcp_call',
    tool: 'demo'
  })

  await logger.shutdown()

  const content = await readFile(join(auditDir, 'session-1.jsonl'), 'utf8')
  const records = content.trim().split(/\r?\n/).map((line) => JSON.parse(line))

  assert.deepEqual(records.slice(0, 5).map((record) => record.category), AUDIT_EVENT_CATEGORIES)
  assert.equal(records[5].event, 'mcp_call')
  assert.equal(records[5].category, 'tool_call')
  assert.ok(records.every((record) => record.hash))
})
