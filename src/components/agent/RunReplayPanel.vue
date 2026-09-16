<template>
  <section class="run-replay" aria-label="任务回放">
    <header class="run-replay__header">
      <div>
        <strong>任务回放</strong>
        <p>按一次 Harness 运行查看任务过程</p>
      </div>
      <button type="button" :disabled="loading" @click="loadRuns">{{ loading ? '读取中…' : '刷新任务' }}</button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!runs.length && !loading">暂无第二阶段的任务记录。</p>
    <template v-if="runs.length">
      <label class="run-replay__selector">选择运行
        <select v-model="runId" :disabled="loading" @change="loadReplay()">
          <option v-for="(run, index) in runs" :key="run.runId" :value="run.runId">
            {{ runDisplayLabel(run, index) }}
          </option>
        </select>
      </label>
      <template v-if="replay">
        <div class="run-replay__controls">
          <button type="button" :disabled="loading || position <= 0" @click="seek(position - 1)">上一步</button>
          <div class="run-replay__progress-track">
            <input aria-label="回放进度" type="range" min="0" :max="Math.max(0, sequences.length - 1)"
              :value="position" :disabled="loading" @change="seek(Number($event.target.value))" />
            <span>事件 {{ replay.throughSequence }} / {{ replay.events.length }}</span>
          </div>
          <button type="button" :disabled="loading || position >= sequences.length - 1" @click="seek(position + 1)">下一步</button>
        </div>
        <section class="run-replay__current-event">
          <div class="run-replay__current-event-head">
            <span>运行 {{ selectedRunOrdinal }} · Harness 事件 {{ replay.throughSequence }} / {{ replay.events.length }}</span>
            <strong>{{ statusLabel(replay.status) }}</strong>
          </div>
          <h4>{{ eventLabel(currentEvent) }}</h4>
          <p>{{ eventSummary(currentEvent) }}</p>
        </section>
        <p class="run-replay__mapping-hint">
          回放中的 Harness 事件序号与上方“审计事件”列表独立计算，不是一一对应的审计事件序号。
        </p>
        <p v-if="replay.incomplete" class="run-replay__notice" role="status">日志存在缺失或截断，只能查看部分过程，无法可靠复验。</p>
        <p v-if="replay.interrupted" class="run-replay__notice" role="status">本次运行没有结束记录，可能已中断。</p>
        <div class="run-replay__overview">
          <section class="run-replay__result-block">
            <h4>任务结果</h4>
            <dl>
              <div><dt>文件变化</dt><dd>{{ replay.evidence.workspace.changedFiles.join('、') || '尚未记录' }}</dd></div>
              <div><dt>证据复验</dt><dd>{{ statusLabel(replay.replayedEvaluation?.status || 'pending') }}</dd></div>
              <div><dt>最近验收</dt><dd>{{ statusLabel(replay.evaluation?.status || 'pending') }}</dd></div>
              <div v-if="replay.failure"><dt>失败原因</dt><dd>{{ replay.failure.category }}：{{ replay.failure.message }}</dd></div>
            </dl>
          </section>
          <section v-if="replay.budget" class="run-replay__budget-block">
            <h4>预算使用</h4>
            <table>
              <thead><tr><th>项目</th><th>已用</th><th>上限</th></tr></thead>
              <tbody><tr v-for="dimension in dimensions" :key="dimension.key">
                <td>{{ dimension.label }}</td><td>{{ formatBudget(replay.budget.used[dimension.key], dimension.key) }}</td>
                <td>{{ replay.budget.limits[dimension.key] === 0 && dimension.key !== 'repairs' ? '未限制' : formatBudget(replay.budget.limits[dimension.key], dimension.key) }}</td>
              </tr></tbody>
            </table>
          </section>
        </div>
        <p v-if="replay.budget?.used.unknownUsageCalls" class="run-replay__notice">有 {{ replay.budget.used.unknownUsageCalls }} 次请求未获得 Token 用量，统计不完整。</p>
        <ul v-if="replay.evaluation?.failedCriteria?.length" class="run-replay__failed-list">
          <li v-for="criterion in replay.evaluation.failedCriteria" :key="criterion.id">{{ criterion.description }}</li>
        </ul>
        <details>
          <summary>查看技术详情</summary>
          <div class="run-replay__details">
            <div v-for="item in eventDetailItems(currentEvent)" :key="item.label">
              <span>{{ item.label }}</span><strong>{{ item.value }}</strong>
            </div>
          </div>
        </details>
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
const selectedRunOrdinal = computed(() => {
  const index = runs.value.findIndex((run) => run.runId === runId.value)
  return index >= 0 ? index + 1 : 0
})
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
function runDisplayLabel(run, index) {
  const title = run.displayTitle || run.title || '未命名对话'
  const ordinal = index + 1
  return `运行 ${ordinal} · ${title} · ${run.eventCount || 0} 条 Harness 事件`
}
const eventDetailItems = (event) => {
  if (!event) return []
  const items = []
  const add = (label, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') items.push({ label, value: String(value) })
  }
  const failure = event.failure && typeof event.failure === 'object'
    ? [event.failure.category, event.failure.message].filter(Boolean).join('：') : event.failure
  add('事件', eventLabel(event))
  add('发生时间', event.at ? new Date(event.at).toLocaleString('zh-CN') : '')
  add('任务 ID', event.taskId)
  add('运行 ID', event.runId)
  add('序号', event.sequence)
  add('状态', statusLabel(event.status))
  add('工具', event.tool)
  add('文件', event.path || event.evidence?.path)
  add('命令', event.command ? [event.command, ...(event.args || [])].join(' ') : '')
  add('工作目录', event.cwd)
  add('退出码', event.exitCode)
  add('预算项目', event.dimension)
  add('失败原因', failure)
  add('证据类型', event.evidence?.type)
  add('验证项目', event.commandId != null ? `第 ${Number(event.commandId) + 1} 项` : '')
  add('完成判断', event.evaluation?.status)
  add('未通过条件', event.evaluation?.failedCriteriaIds?.join('、'))
  add('变更文件', event.changedFiles?.join('、'))
  add('预算快照', event.budget?.used ? `模型 ${event.budget.used.modelCalls} 次，工具 ${event.budget.used.toolCalls} 次，修正 ${event.budget.used.repairs} 次` : '')
  return items
}
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
.run-replay {
  padding: 18px 0 14px;
  margin: 16px 0;
  border-block: 1px solid #d9dde5;
  color: #344054;
  font-size: 13px;
}

.run-replay__header,
.run-replay__controls {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}

.run-replay__header > div {
  display: grid;
  gap: 3px;
}

.run-replay__header strong {
  color: #1d2939;
  font-size: 1rem;
}

.run-replay__header p {
  margin: 0;
  color: #98a2b3;
  font-size: 0.76rem;
}

.run-replay button,
.run-replay select {
  min-height: 32px;
  padding: 5px 9px;
  border: 1px solid #ccd1dc;
  border-radius: 7px;
  background: #ffffff;
  color: inherit;
  font: inherit;
}

.run-replay button { cursor: pointer; }
.run-replay button:disabled { opacity: .5; cursor: default; }

.run-replay__selector {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.run-replay__selector select { min-width: 0; width: 100%; }

.run-replay__controls {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  margin-top: 14px;
}

.run-replay__progress-track {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.run-replay__progress-track input {
  width: 100%;
  min-width: 30px;
  accent-color: #1677ff;
}

.run-replay__progress-track span {
  color: #98a2b3;
  font-size: 0.72rem;
  text-align: center;
}

.run-replay__current-event {
  display: grid;
  gap: 6px;
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid #dbe3f0;
  border-radius: 10px;
  background: #f8faff;
}

.run-replay__current-event-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #667085;
  font-size: 0.76rem;
}

.run-replay__current-event-head strong {
  color: #227a48;
  font-size: 0.76rem;
}

.run-replay__current-event h4,
.run-replay__result-block h4,
.run-replay__budget-block h4 {
  margin: 0;
  color: #1d2939;
  font-size: 0.92rem;
}

.run-replay__current-event p,
.run-replay__mapping-hint,
.run-replay__notice {
  margin: 0;
  overflow-wrap: anywhere;
}

.run-replay__current-event p { color: #667085; line-height: 1.6; }

.run-replay__mapping-hint {
  margin-top: 8px;
  color: #98a2b3;
  font-size: 0.74rem;
}

.run-replay__notice {
  margin-top: 10px;
  color: #a15c00;
  font-size: 0.78rem;
}

.run-replay__overview {
  display: grid;
  grid-template-columns: minmax(220px, 0.78fr) minmax(360px, 1.22fr);
  gap: 12px;
  margin-top: 14px;
}

.run-replay__result-block,
.run-replay__budget-block {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid #e4e9f2;
  border-radius: 10px;
  background: #ffffff;
}

.run-replay dl {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
}

.run-replay dl > div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  margin: 0;
}

.run-replay dt {
  flex-shrink: 0;
  color: #98a2b3;
}

.run-replay dd {
  min-width: 0;
  margin: 0;
  color: #344054;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.run-replay table {
  width: 100%;
  margin-top: 8px;
  border-collapse: collapse;
}

.run-replay th,
.run-replay td {
  padding: 6px 4px;
  border-bottom: 1px solid #edf0f4;
  text-align: left;
}

.run-replay th { color: #667085; font-weight: 700; }
.run-replay td { color: #344054; }

.run-replay__failed-list {
  margin: 12px 0 0;
  padding: 10px 12px 10px 28px;
  border-radius: 8px;
  background: #fff7ed;
  color: #9a3412;
}

.run-replay details { margin-top: 14px; }
.run-replay details summary { color: #3155c8; cursor: pointer; text-align: right; }

.run-replay__details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 14px;
  margin-top: 10px;
  padding: 12px;
  border: 1px solid #e4e9f2;
  border-radius: 8px;
  background: #f8faff;
}

.run-replay__details div { display: grid; gap: 3px; min-width: 0; }
.run-replay__details span { color: #7a869f; font-size: .75rem; }
.run-replay__details strong { color: #344054; overflow-wrap: anywhere; }

@media (max-width: 720px) {
  .run-replay__overview { grid-template-columns: 1fr; }
}
</style>
