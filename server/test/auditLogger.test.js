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

test('drain waits for in-flight records and marks lossy replay data', async () => {
  const auditDir = await mkdtemp(join(tmpdir(), 'agent-audit-drain-'))
  const logger = createAuditLogger({ auditDir, batchSize: 1 })
  try {
    logger.logEvent({ sessionId: 'session-1', event: 'harness_event', sequence: 1, path: 'x'.repeat(1300) })
    const pending = logger.flush()
    logger.logEvent({ sessionId: 'session-1', event: 'harness_event', sequence: 2, budget: { totalTokens: 12 }, apiKey: 'private' })
    await logger.drain()
    await pending
    const records = (await readFile(join(auditDir, 'session-1.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
    assert.equal(records.length, 2)
    assert.equal(records[0].dataTruncated, true)
    assert.equal(records[1].apiKey, '[redacted]')
    assert.equal(records[1].budget.totalTokens, 12)
    assert.equal(records[1].prevHash, records[0].hash)
  } finally { await logger.shutdown() }
})
