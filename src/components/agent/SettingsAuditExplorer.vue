<template>
  <section class="settings-audit">
    <aside class="settings-audit__sessions">
      <div class="settings-audit__panel-head">
        <div>
          <p class="settings-audit__eyebrow">Audit Sessions</p>
          <h3>审计会话</h3>
        </div>
        <button type="button" :disabled="isLoadingSessions" @click="loadAuditSessions">
          {{ isLoadingSessions ? '刷新中' : '刷新' }}
        </button>
      </div>

      <p v-if="sessionError" class="settings-audit__status is-error">{{ sessionError }}</p>
      <p v-else-if="isLoadingSessions" class="settings-audit__status">正在读取审计日志...</p>
      <p v-else-if="!auditSessions.length" class="settings-audit__status">暂无审计日志。Agent 运行后会自动生成。</p>

      <div v-else class="settings-audit__session-list">
        <button
          v-for="item in auditSessions"
          :key="item.sessionId"
          type="button"
          class="settings-audit__session"
          :class="{ 'is-active': item.sessionId === selectedSessionId }"
          @click="selectAuditSession(item.sessionId)"
        >
          <strong>{{ item.sessionId }}</strong>
          <span>{{ item.eventCount || 0 }} 条事件 · {{ formatDateTime(item.updatedAt) }}</span>
          <small>{{ item.lastEvent || 'event' }}</small>
        </button>
      </div>
    </aside>

    <section class="settings-audit__events">
      <div class="settings-audit__panel-head settings-audit__panel-head--events">
        <div>
          <p class="settings-audit__eyebrow">Timeline</p>
          <h3>{{ selectedSessionId || '选择一个审计会话' }}</h3>
          <p v-if="selectedSessionId" class="settings-audit__sub">
            当前返回 {{ auditEvents.length }} 条事件，按发生顺序展示。
          </p>
        </div>

        <div class="settings-audit__filters">
          <select v-model="selectedEventType" :disabled="!selectedSessionId || isLoadingEvents" @change="loadAuditEvents">
            <option value="">全部事件</option>
            <option v-for="eventType in eventTypes" :key="eventType" :value="eventType">
              {{ eventType }}
            </option>
          </select>
          <button type="button" :disabled="!selectedSessionId || isLoadingEvents" @click="loadAuditEvents">
            {{ isLoadingEvents ? '读取中' : '刷新事件' }}
          </button>
        </div>
      </div>

      <p v-if="eventError" class="settings-audit__status is-error">{{ eventError }}</p>
      <p v-else-if="isLoadingEvents" class="settings-audit__status">正在读取事件时间线...</p>
      <p v-else-if="!selectedSessionId" class="settings-audit__status">从左侧选择一个会话，查看 Agent 的决策和工具调用链路。</p>
      <p v-else-if="!auditEvents.length" class="settings-audit__status">当前筛选条件下没有事件。</p>

      <div v-else class="settings-audit__timeline">
        <article
          v-for="(event, index) in auditEvents"
          :key="`${event.ts || event.time || index}-${index}`"
          class="settings-audit-event"
          :class="eventClass(event)"
        >
          <div class="settings-audit-event__rail" aria-hidden="true">
            <span></span>
          </div>

          <div class="settings-audit-event__card">
            <header class="settings-audit-event__head">
              <div>
                <span class="settings-audit-event__type">{{ eventLabel(event) }}</span>
                <strong>{{ eventTitle(event) }}</strong>
              </div>
              <time>{{ formatDateTime(event.ts || event.time) }}</time>
            </header>

            <dl class="settings-audit-event__meta">
              <div v-if="event.tool">
                <dt>工具</dt>
                <dd>{{ eventToolLabel(event) }}</dd>
              </div>
              <div v-if="event.action">
                <dt>动作</dt>
                <dd>{{ actionLabel(event.action) }}</dd>
              </div>
              <div v-if="event.status">
                <dt>状态</dt>
                <dd>{{ statusLabel(event.status) }}</dd>
              </div>
              <div v-if="event.scope">
                <dt>范围</dt>
                <dd>{{ event.scope }}</dd>
              </div>
              <div v-if="event.model">
                <dt>模型</dt>
                <dd>{{ event.model }}</dd>
              </div>
              <div v-if="usageText(event.usage)">
                <dt>Token</dt>
                <dd>{{ usageText(event.usage) }}</dd>
              </div>
            </dl>

            <p v-if="eventSummary(event)" class="settings-audit-event__summary">
              {{ eventSummary(event) }}
            </p>

            <div class="settings-audit-event__actions">
              <button type="button" @click="toggleExpanded(index)">
                {{ expandedEventIndexes.has(index) ? '收起 JSON' : '展开 JSON' }}
              </button>
              <button type="button" @click="copyEvent(event)">
                复制
              </button>
            </div>

            <pre v-if="expandedEventIndexes.has(index)" class="settings-audit-event__json">{{ formatJson(event) }}</pre>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { createMessage } from 'snowingress-my-components'
import http from '../../http.js'

const auditSessions = ref([])
const auditEvents = ref([])
const eventTypes = ref([])
const selectedSessionId = ref('')
const selectedEventType = ref('')
const expandedEventIndexes = ref(new Set())
const isLoadingSessions = ref(false)
const isLoadingEvents = ref(false)
const sessionError = ref('')
const eventError = ref('')

function formatDateTime(value) {
  const timestamp = Date.parse(String(value || ''))

  if (!Number.isFinite(timestamp)) {
    return '未知时间'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))
}

function eventClass(event) {
  const type = String(event?.event || '').toLowerCase()

  if (type.includes('error')) {
    return 'is-error'
  }

  if (type.includes('mcp')) {
    return 'is-mcp'
  }

  if (type.includes('rag')) {
    return 'is-rag'
  }

  if (type.includes('tool') || type.includes('workspace')) {
    return 'is-tool'
  }

  if (type.includes('llm') || type.includes('ai_message')) {
    return 'is-llm'
  }

  return 'is-system'
}

function eventLabel(event) {
  const type = String(event?.event || '').toLowerCase()
  const action = String(event?.action || '').toLowerCase()
  const status = String(event?.status || '').toLowerCase()
  const mode = skillMode(event)

  if (type === 'user_message') return '用户消息'
  if (type === 'ai_message') return '回复入库'
  if (type === 'llm_input') return event?.stage === 'final_text' ? '最终输入' : '模型输入'
  if (type === 'llm_decision') return '模型决策'
  if (type === 'llm_final_text') return '最终回答'
  if (isSkillToolEvent(event) && mode === 'help') return '读取 Skill'
  if (isSkillToolEvent(event) && mode === 'run') return '激活 Skill'
  if (type === 'tool_call') return '工具调用'
  if (type === 'tool_result') return '工具结果'
  if (type === 'rag_search') return status === 'started' ? '开始检索' : '检索结果'
  if (type.includes('mcp')) return 'MCP'
  if (type === 'system_action' && action === 'task_started') return '任务开始'
  if (type === 'system_action' && action === 'task_completed') return '任务完成'
  if (type === 'system_action' && action === 'task_failed') return '任务失败'
  if (type === 'system_action' && action === 'skill_help') return '读取 Skill'
  if (type === 'system_action' && action === 'skill_run') return '激活 Skill'
  if (type.includes('error')) return '错误'

  return event?.event || '事件'
}

function actionLabel(value) {
  const action = String(value || '').toLowerCase()

  if (action === 'tool') return '调用工具'
  if (action === 'final') return '准备最终回复'
  if (action === 'ask_user') return '询问用户'
  if (action === 'task_started') return '任务开始'
  if (action === 'task_completed') return '任务完成'
  if (action === 'task_failed') return '任务失败'

  return String(value || '')
}

function statusLabel(value) {
  const status = String(value || '').toLowerCase()

  if (status === 'started') return '进行中'
  if (status === 'success') return '成功'
  if (status === 'failed' || status === 'error') return '失败'
  if (status === 'completed') return '完成'

  return String(value || '')
}

function formatToolName(value) {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object') {
    return value.name || value.tool || JSON.stringify(value)
  }

  return ''
}

function eventToolLabel(event) {
  if (isSkillToolEvent(event)) {
    return `Skill：${skillDisplayName(event)}`
  }

  return formatToolName(event?.tool)
}

function isSkillToolEvent(event) {
  return formatToolName(event?.tool) === 'skill'
}

function skillMode(event) {
  return String(event?.args?.mode || event?.result?.mode || event?.mode || '').toLowerCase()
}

function skillDisplayName(event) {
  return event?.result?.name || event?.skillName || event?.args?.skillId || event?.result?.skillId || event?.skillId || '未知 Skill'
}

function formatList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join('、') : String(value || '')
}

function usageText(usage) {
  if (!usage || typeof usage !== 'object') {
    return ''
  }

  const input = usage.inputTokens ?? usage.promptTokens
  const output = usage.outputTokens ?? usage.completionTokens
  const total = usage.totalTokens ?? usage.tokens

  return [
    input != null ? `输入 ${input}` : '',
    output != null ? `输出 ${output}` : '',
    total != null ? `总计 ${total}` : ''
  ].filter(Boolean).join(' / ')
}

function createReadableEventTitle(event) {
  const type = String(event?.event || '').toLowerCase()
  const action = String(event?.action || '').toLowerCase()
  const status = String(event?.status || '').toLowerCase()
  const mode = skillMode(event)
  const skillName = skillDisplayName(event)

  if (type === 'user_message') return `用户发送：${event?.contentPreview || '(空消息)'}`
  if (type === 'rag_search' && status === 'started') return `开始检索知识库：${formatList(event?.collectionIds) || '默认'}`
  if (type === 'rag_search') return `知识库检索完成，命中 ${event?.hitCount ?? 0} 条`
  if (type === 'llm_input') return event?.stage === 'final_text' ? '把上下文发送给模型生成最终回复' : '把上下文发送给模型判断下一步'
  if (type === 'llm_decision') return `模型决定：${actionLabel(event?.action)}`
  if (isSkillToolEvent(event) && type === 'tool_call' && mode === 'help') return `开始读取 Skill 说明：${skillName}`
  if (isSkillToolEvent(event) && type === 'tool_result' && mode === 'help') return `Skill 说明读取成功：${skillName}`
  if (isSkillToolEvent(event) && type === 'tool_call' && mode === 'run') return `开始激活 Skill：${skillName}`
  if (isSkillToolEvent(event) && type === 'tool_result' && mode === 'run') return `Skill 激活成功：${skillName}`
  if (type === 'tool_call') return `开始调用工具：${formatToolName(event?.tool)}`
  if (type === 'tool_result') return `${statusLabel(event?.status) || '完成'}工具：${formatToolName(event?.tool)}`
  if (type === 'llm_final_text') return '模型生成最终自然语言回复'
  if (type === 'ai_message') return '回复已保存到会话'
  if (type === 'system_action' && action === 'task_started') return '任务已开始'
  if (type === 'system_action' && action === 'task_completed') return '任务已完成'
  if (type === 'system_action' && action === 'task_failed') return '任务执行失败'
  if (type === 'system_action' && action === 'skill_help') return `Skill 说明已读取：${skillName}`
  if (type === 'system_action' && action === 'skill_run') return `Skill 已激活：${skillName}`

  return ''
}

function eventTitle(event) {
  const readableTitle = createReadableEventTitle(event)

  if (readableTitle) {
    return readableTitle
  }

  return String(
    event?.summary
    || event?.message
    || event?.action
    || event?.tool
    || event?.scope
    || event?.event
    || '审计事件'
  ).trim()
}

function createReadableEventSummary(event) {
  const type = String(event?.event || '').toLowerCase()
  const mode = skillMode(event)

  if (type === 'llm_decision') {
    return event?.thoughtSummary || event?.summary || ''
  }

  if (isSkillToolEvent(event) && mode === 'help') {
    return 'help 阶段只读取 Skill 说明，供模型判断和参考；还没有正式启用这个 Skill。'
  }

  if (isSkillToolEvent(event) && mode === 'run') {
    return 'run 阶段表示正式激活这个 Skill，后续模型会按该 Skill 的规则继续执行。'
  }

  if (type === 'tool_call') {
    return event?.thoughtSummary || event?.summary || ''
  }

  if (type === 'tool_result') {
    return event?.summary || event?.result?.summary || event?.resultPreview || ''
  }

  if (type === 'system_action' && Array.isArray(event?.changedFiles) && event.changedFiles.length) {
    return `涉及文件：${event.changedFiles.join('、')}`
  }

  return ''
}

function eventSummary(event) {
  const readableSummary = createReadableEventSummary(event)

  if (readableSummary) {
    return readableSummary
  }

  return String(
    event?.contentPreview
    || event?.replyPreview
    || event?.resultPreview
    || event?.profilePreview
    || event?.error
    || ''
  ).trim()
}

function formatJson(value) {
  return JSON.stringify(value, null, 2)
}

function toggleExpanded(index) {
  const nextIndexes = new Set(expandedEventIndexes.value)

  if (nextIndexes.has(index)) {
    nextIndexes.delete(index)
  } else {
    nextIndexes.add(index)
  }

  expandedEventIndexes.value = nextIndexes
}

async function copyEvent(event) {
  try {
    await navigator.clipboard?.writeText(formatJson(event))
    createMessage({ message: '已复制审计事件', type: 'success', duration: 1800, offset: 24 })
  } catch {
    createMessage({ message: '复制失败', type: 'error', duration: 2200, offset: 24 })
  }
}

async function loadAuditSessions() {
  isLoadingSessions.value = true
  sessionError.value = ''

  try {
    const response = await http.get('/api/agent/audit/sessions')
    auditSessions.value = Array.isArray(response?.items) ? response.items : []

    if (!auditSessions.value.length) {
      selectedSessionId.value = ''
      auditEvents.value = []
      eventTypes.value = []
      return
    }

    if (!selectedSessionId.value || !auditSessions.value.some((item) => item.sessionId === selectedSessionId.value)) {
      await selectAuditSession(auditSessions.value[0].sessionId)
    }
  } catch (error) {
    sessionError.value = error instanceof Error ? error.message : '读取审计会话失败。'
    auditSessions.value = []
  } finally {
    isLoadingSessions.value = false
  }
}

async function selectAuditSession(sessionId) {
  selectedSessionId.value = String(sessionId || '').trim()
  selectedEventType.value = ''
  await loadAuditEvents()
}

async function loadAuditEvents() {
  if (!selectedSessionId.value) {
    return
  }

  isLoadingEvents.value = true
  eventError.value = ''
  expandedEventIndexes.value = new Set()

  try {
    const response = await http.get('/api/agent/audit/events', {
      params: {
        sessionId: selectedSessionId.value,
        event: selectedEventType.value || undefined,
        limit: 500
      }
    })

    auditEvents.value = Array.isArray(response?.items) ? response.items : []
    eventTypes.value = Array.isArray(response?.eventTypes) ? response.eventTypes : []
  } catch (error) {
    eventError.value = error instanceof Error ? error.message : '读取审计事件失败。'
    auditEvents.value = []
  } finally {
    isLoadingEvents.value = false
  }
}

async function refresh() {
  const previousSessionId = selectedSessionId.value
  await loadAuditSessions()

  if (selectedSessionId.value && selectedSessionId.value === previousSessionId) {
    await loadAuditEvents()
  }
}

defineExpose({
  refresh
})

onMounted(() => {
  void loadAuditSessions()
})
</script>

<style scoped>
.settings-audit {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 18px;
  height: 100%;
  min-height: 420px;
}

.settings-audit__sessions,
.settings-audit__events {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #e7ebf3;
  border-radius: 20px;
  background: #ffffff;
}

.settings-audit__sessions {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.settings-audit__events {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.settings-audit__panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 18px;
  border-bottom: 1px solid #eef1f6;
}

.settings-audit__panel-head--events {
  align-items: center;
}

.settings-audit__eyebrow,
.settings-audit__sub {
  margin: 0;
}

.settings-audit__eyebrow {
  margin-bottom: 6px;
  color: #7a869f;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-audit__panel-head h3 {
  margin: 0;
  color: #171717;
  font-size: 1.1rem;
}

.settings-audit__sub {
  margin-top: 8px;
  color: #7b8498;
  font-size: 0.84rem;
}

.settings-audit button,
.settings-audit select {
  min-height: 34px;
  border: 1px solid #dfe5f1;
  border-radius: 10px;
  background: #ffffff;
  color: #344054;
  cursor: pointer;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 700;
  padding: 0 11px;
}

.settings-audit button:disabled,
.settings-audit select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.settings-audit__filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.settings-audit__status {
  margin: 0;
  padding: 18px;
  color: #6b7280;
  line-height: 1.7;
}

.settings-audit__status.is-error {
  color: #b42318;
}

.settings-audit__session-list {
  display: grid;
  align-content: start;
  gap: 6px;
  overflow: auto;
  padding: 12px;
}

.settings-audit__session {
  display: grid;
  gap: 5px;
  width: 100%;
  min-height: auto;
  padding: 12px 13px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  text-align: left;
}

.settings-audit__session:hover {
  background: #f4f7fc;
}

.settings-audit__session.is-active {
  background: #eaf1ff;
  color: #214dba;
}

.settings-audit__session strong,
.settings-audit__session span,
.settings-audit__session small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-audit__session span,
.settings-audit__session small {
  color: #75819a;
  font-size: 0.78rem;
  font-weight: 600;
}

.settings-audit__timeline {
  display: grid;
  align-content: start;
  gap: 12px;
  overflow: auto;
  padding: 16px 18px 18px;
}

.settings-audit-event {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 12px;
}

.settings-audit-event__rail {
  position: relative;
}

.settings-audit-event__rail::before {
  content: "";
  position: absolute;
  top: 18px;
  bottom: -18px;
  left: 8px;
  width: 2px;
  border-radius: 999px;
  background: #e4e9f3;
}

.settings-audit-event__rail span {
  position: relative;
  z-index: 1;
  display: block;
  width: 18px;
  height: 18px;
  margin-top: 15px;
  border: 4px solid #eef4ff;
  border-radius: 999px;
  background: #5b7cfa;
}

.settings-audit-event__card {
  min-width: 0;
  border: 1px solid #e7ebf3;
  border-radius: 16px;
  background: #ffffff;
  padding: 14px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.04);
}

.settings-audit-event__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.settings-audit-event__head > div {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.settings-audit-event__head strong {
  min-width: 0;
  overflow: hidden;
  color: #1f2a3d;
  font-size: 0.94rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-audit-event__head time {
  flex: 0 0 auto;
  color: #8a94a7;
  font-size: 0.78rem;
  font-weight: 700;
}

.settings-audit-event__type {
  flex: 0 0 auto;
  border-radius: 999px;
  background: #eef3ff;
  color: #3155c8;
  font-size: 0.72rem;
  font-weight: 800;
  padding: 4px 8px;
}

.settings-audit-event__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 12px 0 0;
}

.settings-audit-event__meta div {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.settings-audit-event__meta dt,
.settings-audit-event__meta dd {
  margin: 0;
  font-size: 0.78rem;
}

.settings-audit-event__meta dt {
  color: #8a94a7;
  font-weight: 800;
}

.settings-audit-event__meta dd {
  color: #344054;
  font-weight: 700;
}

.settings-audit-event__summary {
  margin: 12px 0 0;
  color: #4b5563;
  font-size: 0.88rem;
  line-height: 1.7;
}

.settings-audit-event__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.settings-audit-event__actions button {
  min-height: 30px;
  padding: 0 10px;
  font-size: 0.78rem;
}

.settings-audit-event__json {
  max-height: 340px;
  overflow: auto;
  margin: 12px 0 0;
  border-radius: 12px;
  background: #0f172a;
  color: #dbeafe;
  font-family: Consolas, 'SFMono-Regular', Menlo, Monaco, monospace;
  font-size: 0.78rem;
  line-height: 1.65;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.settings-audit-event.is-error .settings-audit-event__rail span {
  border-color: #fee2e2;
  background: #ef4444;
}

.settings-audit-event.is-mcp .settings-audit-event__rail span {
  border-color: #ede9fe;
  background: #8b5cf6;
}

.settings-audit-event.is-rag .settings-audit-event__rail span {
  border-color: #dcfce7;
  background: #22c55e;
}

.settings-audit-event.is-tool .settings-audit-event__rail span {
  border-color: #ffedd5;
  background: #f97316;
}

.settings-audit-event.is-llm .settings-audit-event__rail span {
  border-color: #dbeafe;
  background: #3b82f6;
}

@media (max-width: 1080px) {
  .settings-audit {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(260px, 0.75fr) minmax(360px, 1fr);
  }

  .settings-audit__panel-head--events {
    align-items: stretch;
    flex-direction: column;
  }

  .settings-audit__filters {
    flex-wrap: wrap;
  }
}
</style>
