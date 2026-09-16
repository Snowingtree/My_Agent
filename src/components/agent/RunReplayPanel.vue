<template>
  <section class="run-replay" aria-label="任务回放">
    <header>
      <strong>任务回放</strong>
      <button type="button" :disabled="loading" @click="loadRuns">{{ loading ? '读取中…' : '刷新任务' }}</button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!runs.length && !loading">暂无第二阶段的任务记录。</p>
    <template v-if="runs.length">
      <label>选择任务
        <select v-model="runId" :disabled="loading" @change="loadReplay()">
          <option v-for="run in runs" :key="run.runId" :value="run.runId">
            {{ run.taskId }} · {{ statusLabel(run.interrupted ? 'interrupted' : run.status) }}
          </option>
        </select>
      </label>
      <template v-if="replay">
        <div class="run-replay__controls">
          <button type="button" :disabled="loading || position <= 0" @click="seek(position - 1)">上一步</button>
          <input aria-label="回放进度" type="range" min="0" :max="Math.max(0, sequences.length - 1)"
            :value="position" :disabled="loading" @change="seek(Number($event.target.value))" />
          <button type="button" :disabled="loading || position >= sequences.length - 1" @click="seek(position + 1)">下一步</button>
        </div>
        <div class="run-replay__current-event">
          <span>第 {{ replay.throughSequence }} 条</span>
          <strong>{{ eventLabel(currentEvent) }}</strong>
          <span>{{ statusLabel(replay.status) }}</span>
        </div>
        <p class="run-replay__event-summary">{{ eventSummary(currentEvent) }}</p>
        <p v-if="replay.incomplete" role="status">日志存在缺失或截断，只能查看部分过程，无法可靠复验。</p>
        <p v-if="replay.interrupted" role="status">本次运行没有结束记录，可能已中断。</p>
        <dl>
          <div><dt>文件变化</dt><dd>{{ replay.evidence.workspace.changedFiles.join('、') || '尚未记录' }}</dd></div>
          <div><dt>证据复验</dt><dd>{{ statusLabel(replay.replayedEvaluation?.status || 'pending') }}</dd></div>
          <div><dt>最近验收</dt><dd>{{ statusLabel(replay.evaluation?.status || 'pending') }}</dd></div>
          <div v-if="replay.failure"><dt>失败原因</dt><dd>{{ replay.failure.category }}：{{ replay.failure.message }}</dd></div>
        </dl>
        <table v-if="replay.budget">
          <thead><tr><th>预算</th><th>已用</th><th>上限</th></tr></thead>
          <tbody><tr v-for="dimension in dimensions" :key="dimension.key">
            <td>{{ dimension.label }}</td><td>{{ formatBudget(replay.budget.used[dimension.key], dimension.key) }}</td>
            <td>{{ replay.budget.limits[dimension.key] === 0 && dimension.key !== 'repairs' ? '未限制' : formatBudget(replay.budget.limits[dimension.key], dimension.key) }}</td>
          </tr></tbody>
        </table>
        <p v-if="replay.budget?.used.unknownUsageCalls">有 {{ replay.budget.used.unknownUsageCalls }} 次请求未获得 Token 用量，统计不完整。</p>
        <ul v-if="replay.evaluation?.failedCriteria?.length">
          <li v-for="criterion in replay.evaluation.failedCriteria" :key="criterion.id">{{ criterion.description }}</li>
        </ul>
        <details><summary>查看技术详情</summary><pre>{{ JSON.stringify(currentEvent, null, 2) }}</pre></details>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import http from '../../http.js'
const props = defineProps({ sessionId: { type: String, required: true } })
const runs = ref([])
const runId = ref('')
const replay = ref(null)
const sequences = ref([])
const position = ref(0)
const loading = ref(false)
const error = ref('')
let requestVersion = 0
const currentEvent = computed(() => replay.value?.events.at(-1))
const dimensions = [
  { key: 'modelCalls', label: '模型请求' }, { key: 'toolCalls', label: '工具请求' },
  { key: 'repairs', label: '修正次数' }, { key: 'totalTokens', label: 'Token' },
  { key: 'activeMs', label: '执行时长' }
]
const eventLabels = {
  'run.started': '任务开始', 'run.resumed': '任务恢复', 'run.finished': '任务结束',
  'contract.created': '确定完成条件', 'verification.planned': '确定验证方案',
  'verification.started': '开始验证修改', 'verification.command': '执行验证命令',
  'verification.passed': '验证通过', 'verification.failed': '验证失败',
  'evidence.recorded': '记录任务证据', 'budget.consumed': '消耗任务预算',
  'budget.exhausted': '任务预算耗尽', 'model.started': '开始请求模型',
  'model.completed': '模型请求完成', 'model.failed': '模型请求失败',
  'model.usage': '记录模型用量', 'tool.requested': '请求调用工具',
  'tool.completed': '工具调用完成', 'tool.failed': '工具调用失败',
  'completion.evaluated': '检查完成条件', 'failure.observed': '记录任务失败'
}
const statusLabel = (value) => ({ running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消',
  waiting_for_user: '等待用户', passed: '通过', repairable: '待修正', pending: '尚未验收', interrupted: '已中断' })[value] || value
const formatBudget = (value, key) => key === 'activeMs' ? `${((value || 0) / 1000).toFixed(1)} 秒` : value ?? 0
const eventLabel = (event) => eventLabels[String(event?.type || '').toLowerCase()] || '任务运行事件'
const eventSummary = (event) => {
  const type = String(event?.type || '').toLowerCase()
  if (type === 'run.started') return 'Harness 已建立运行记录并开始统计预算。'
  if (type === 'run.resumed') return '任务恢复执行，之前的预算和证据已保留。'
  if (type === 'run.finished') return `本次运行已结束，状态为“${statusLabel(event?.status)}”。`
  if (type === 'contract.created') return '系统已把用户目标转换成可检查的完成条件。'
  if (type === 'verification.command') return event?.status === 'success' ? '这项验证命令执行成功。' : '这项验证命令没有通过。'
  if (type === 'verification.passed') return '最近一次文件修改后的验证已通过。'
  if (type === 'verification.failed') return '至少一项验证没有通过，任务不能直接算完成。'
  if (type === 'budget.exhausted') return `任务已停止，因为${event?.failure?.dimension || '执行'}预算达到上限。`
  if (type === 'model.failed' || type === 'tool.failed' || type === 'failure.observed') return event?.failure?.message || '执行出现失败。'
  if (type === 'completion.evaluated') return `当前完成条件状态为“${statusLabel(event?.evaluation?.status)}”。`
  if (type === 'tool.requested') return `Agent 请求调用工具${event?.tool ? `“${event.tool}”` : ''}。`
  if (type === 'tool.completed') return '工具调用完成，结果已纳入任务证据。'
  return '这是一次任务运行状态记录。'
}
async function loadRuns() {
  const version = ++requestVersion
  loading.value = true
  error.value = ''
  replay.value = null
  try {
    const result = await http.get('/api/agent/audit/runs', { params: { sessionId: props.sessionId } })
    if (version !== requestVersion) return
    runs.value = result.items
    runId.value = runs.value.some((run) => run.runId === runId.value) ? runId.value : runs.value[0]?.runId || ''
    if (runId.value) await loadReplay()
  } catch (cause) { if (version === requestVersion) error.value = cause.message }
  finally { if (version === requestVersion) loading.value = false }
}
async function loadReplay(throughSequence) {
  const version = ++requestVersion
  loading.value = true
  error.value = ''
  replay.value = null
  try {
    const result = await http.get('/api/agent/audit/replay', {
      params: { sessionId: props.sessionId, runId: runId.value, throughSequence }
    })
    if (version !== requestVersion) return
    replay.value = result
    if (throughSequence === undefined) sequences.value = result.events.map((event) => event.sequence)
    position.value = sequences.value.indexOf(result.throughSequence)
  } catch (cause) { if (version === requestVersion) error.value = cause.message }
  finally { if (version === requestVersion) loading.value = false }
}
function seek(index) { loadReplay(sequences.value[index]) }
watch(() => props.sessionId, () => { runs.value = []; runId.value = ''; loadRuns() }, { immediate: true })
</script>

<style scoped>
.run-replay { padding: 16px 0; margin: 16px 0; border-block: 1px solid #d9dde5; font-size: 13px; }
header, .run-replay__controls { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
select { min-width: 0; max-width: 100%; flex: 1; }
button, select { padding: 6px 8px; border: 1px solid #ccd1dc; border-radius: 6px; background: transparent; color: inherit; }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
.run-replay__controls { margin-top: 16px; } input { flex: 1; min-width: 30px; }
.run-replay__current-event { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 14px; color: #667085; }
.run-replay__current-event strong { color: #1d2939; }
.run-replay__event-summary { color: #667085; }
p, dd { overflow-wrap: anywhere; } dl > div { display: flex; gap: 12px; margin: 8px 0; }
dt { flex-shrink: 0; } dd { margin: 0; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px; border-bottom: 1px solid #d9dde5; }
pre { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
details { margin-top: 12px; }
</style>
