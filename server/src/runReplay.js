import { createCompletionEvidence, recordCompletionEvidence, evaluateCompletion } from './completionHarness.js'

// Read-only projection. No model or tool dispatcher is imported by this module.
export function replayRun(records, runId, throughSequence = Infinity) {
  const events = records.filter((item) => item.event === 'harness_event' && item.runId === runId
    && Number.isInteger(item.sequence) && item.sequence <= throughSequence)
    .sort((a, b) => a.sequence - b.sequence)
  if (!events.length) return null
  let evidence = createCompletionEvidence({ startedAt: events[0].at })
  let contract = null
  let evaluation = null
  let budget = null
  let verificationCommands = []
  let status = 'running'
  let failure = null
  let expected = 1
  let incomplete = false
  for (const event of events) {
    if (event.sequence !== expected || event.droppedBefore || event.dataTruncated || event.schemaVersion !== 1) incomplete = true
    expected = event.sequence + 1
    if (event.budget) budget = event.budget
    if (event.type === 'contract.created') contract = event.contract
    if (event.type === 'verification.planned') verificationCommands = event.commands
    if (event.type === 'evidence.initialized') evidence = createCompletionEvidence(event.evidence)
    if (event.type === 'evidence.recorded') evidence = recordCompletionEvidence(evidence, event.evidence)
    if (event.type === 'completion.evaluated') evaluation = event.evaluation
    if (event.type === 'failure.observed' || event.type === 'budget.exhausted') failure = event.failure
    if (event.type === 'run.started' || event.type === 'run.resumed') status = 'running'
    if (event.type === 'run.finished') { status = event.status; failure = event.failure }
  }
  return { runId, taskId: events[0].taskId, status, failure, budget, contract, evidence, evaluation, verificationCommands,
    replayedEvaluation: contract && !incomplete ? evaluateCompletion(contract, evidence, { evaluatedAt: events.at(-1).at }) : null,
    incomplete, throughSequence: events.at(-1).sequence, events }
}

export function listRunSummaries(records) {
  const ids = [...new Set(records.filter((item) => item.event === 'harness_event' && item.runId && Number.isInteger(item.sequence)).map((item) => item.runId))]
  return ids.map((id) => {
    const replay = replayRun(records, id)
    return { runId: id, taskId: replay.taskId, status: replay.status, failure: replay.failure,
      budget: replay.budget, incomplete: replay.incomplete, eventCount: replay.events.length,
      startedAt: replay.events[0].at, updatedAt: replay.events.at(-1).at }
  }).reverse()
}
