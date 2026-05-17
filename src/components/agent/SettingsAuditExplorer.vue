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
          <small>{{ eventTypeOptionLabel(item.lastEvent) }}</small>
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
              {{ eventTypeOptionLabel(eventType) }}
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

const EVENT_LABELS = {
  api_request: '接口请求',
  api_response: '接口响应',
  auth_success: '登录成功',
  auth_failure: '登录失败',
  user_message: '用户消息',
  ai_message: '回复入库',
  llm_input: '模型输入',
  llm_decision: '模型决策',
  llm_final_text: '最终回答',
  tool_call: '工具调用',
  tool_result: '工具结果',
  tool_approval_requested: '等待确认',
  tool_approval_granted: '确认执行',
  tool_approval_denied: '取消执行',
  tool_approval_consumed: '确认已使用',
  mcp_call: 'MCP 调用',
  mcp_result: 'MCP 结果',
  workspace_read: '读取文件',
  workspace_write: '写入文件',
  rag_search: '知识库检索',
  error: '错误',
  system_action: '系统动作'
}

const ACTION_LABELS = {
  ask_user: '询问用户',
  final: '准备最终回复',
  tool: '调用工具',
  session_created: '创建会话',
  session_deleted: '删除会话',
  task_started: '任务开始',
  task_completed: '任务完成',
  task_failed: '任务失败',
  task_cancelled: '任务取消',
  task_cancel_requested: '请求停止任务',
  skill_help: '读取 Skill 说明',
  skill_run: '激活 Skill',
  skill_run_blocked: 'Skill 激活被阻止',
  protected_tool_help: '读取工具说明',
  protected_tool_run: '执行受保护工具',
  protected_tool_run_blocked: '受保护工具被阻止',
  memory_compacted: '压缩短期记忆',
  user_profile_memory_updated: '更新长期记忆',
  ai_config_created: '创建 AI 配置',
  ai_config_updated: '更新 AI 配置',
  rag_collection_created: '创建知识库集合',
  rag_initialized: '初始化知识库',
  rag_document_created: '创建知识库文档',
  rag_document_uploaded: '上传知识库文档',
  rag_document_deleted: '删除知识库文档',
  rag_embeddings_rebuilt: '重建知识库向量',
  mcp_registry_initialized: '初始化 MCP 工具',
  conversation_messages_migrated: '迁移会话消息',
  token_usage_backfilled: '回填 token 统计',
  server_started: '服务启动',
  server_shutdown_requested: '服务准备关闭'
}

const ACTION_EXPLANATIONS = {
  session_created: '系统创建了一个新的会话记录，并为它准备工作区。',
  session_deleted: '这个会话被删除；审计日志会保留，方便之后追溯。',
  task_started: 'Agent 已经开始处理用户这轮请求。',
  task_completed: 'Agent 已经完成这轮任务并准备或保存了最终回复。',
  task_failed: '这轮任务执行失败，错误原因会记录在事件详情里。',
  task_cancelled: '任务被取消，后续工具和模型调用不会继续执行。',
  task_cancel_requested: '用户或前端发出了停止当前任务的请求。',
  skill_help: 'Agent 读取了 Skill 的详细说明，但这一步还没有正式启用该 Skill。',
  skill_run: 'Agent 正式启用了这个 Skill，后续会按它的规则执行。',
  skill_run_blocked: 'Agent 想启用 Skill，但还没有先读取说明，所以被系统拦截。',
  protected_tool_help: 'Agent 读取了受保护工具的说明，这一步不会执行真实操作。',
  protected_tool_run: '用户确认后，Agent 执行了受保护工具。',
  protected_tool_run_blocked: '受保护工具没有执行，原因可能是没有先读取说明、没有用户确认，或命令策略拒绝。',
  memory_compacted: '当前会话超过双水位阈值，旧轮次被压缩成摘要，最近轮次继续保留。',
  user_profile_memory_updated: '长期用户画像被更新，后续会话会读取这部分记忆。',
  ai_config_created: '管理员新增了一个 AI 配置。',
  ai_config_updated: '管理员修改了一个已有 AI 配置。',
  rag_collection_created: '创建了一个新的知识库集合。',
  rag_initialized: '知识库模块完成初始化或重新初始化。',
  rag_document_created: '手动新增了一篇知识库文档。',
  rag_document_uploaded: '通过上传文件新增了知识库文档。',
  rag_document_deleted: '删除了一篇知识库文档。',
  rag_embeddings_rebuilt: '重新生成知识库向量，用于后续检索。',
  mcp_registry_initialized: 'MCP 工具注册表已经初始化。',
  conversation_messages_migrated: '旧 JSON 会话消息已迁移到 SQLite 记忆库。',
  token_usage_backfilled: '系统从历史消息补齐 token 使用统计。',
  server_started: 'Agent 后端服务已经启动。',
  server_shutdown_requested: '服务收到退出信号，正在刷写审计日志并关闭。'
}

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

function eventTypeOptionLabel(value) {
  const type = String(value || '').toLowerCase()
  return EVENT_LABELS[type] || value || 'event'
}

function eventLabel(event) {
  const type = String(event?.event || '').toLowerCase()
  const action = String(event?.action || '').toLowerCase()
  const status = String(event?.status || '').toLowerCase()
  const mode = skillMode(event)

  if (isSkillToolEvent(event) && mode === 'help') return '读取 Skill'
  if (isSkillToolEvent(event) && mode === 'run') return '激活 Skill'
  if (type === 'llm_input') return event?.stage === 'final_text' ? '最终输入' : '模型输入'
  if (type === 'rag_search') return status === 'started' ? '开始检索' : '检索结果'
  if (type === 'system_action' && ACTION_LABELS[action]) return ACTION_LABELS[action]
  if (type.includes('error')) return '错误'

  return EVENT_LABELS[type] || event?.event || '事件'
}

function actionLabel(value) {
  const action = String(value || '').toLowerCase()

  return ACTION_LABELS[action] || String(value || '')
}

function statusLabel(value) {
  const status = String(value || '').toLowerCase()

  if (status === 'started') return '进行中'
  if (status === 'success') return '成功'
  if (status === 'blocked') return '已阻止'
  if (status === 'failed' || status === 'error') return '失败'
  if (status === 'completed') return '完成'
  if (status === 'running' || status === 'in_progress') return '运行中'
  if (status === 'queued' || status === 'pending') return '排队中'
  if (status === 'cancelled' || status === 'canceled') return '已取消'
  if (status === 'waiting_for_user') return '等待用户'

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
  const requestPath = event?.path || event?.url || ''
  const actionLabelText = actionLabel(action)

  if (type === 'api_request') return `收到接口请求：${event?.method || 'GET'} ${requestPath}`
  if (type === 'api_response') return `接口响应完成：${event?.method || 'GET'} ${requestPath}，状态 ${event?.statusCode ?? '未知'}`
  if (type === 'auth_success') return `登录成功：${event?.username || '未知用户'}`
  if (type === 'auth_failure') return `登录失败：${event?.username || '未知用户'}`
  if (type === 'user_message') return `用户发送：${event?.contentPreview || '(空消息)'}`
  if (type === 'workspace_read') return `读取工作区内容：${event?.path || event?.query || '(未记录路径)'}`
  if (type === 'workspace_write') return `写入工作区文件：${event?.path || '(未记录路径)'}`
  if (type === 'rag_search' && status === 'started') return `开始检索知识库：${formatList(event?.collectionIds) || '默认'}`
  if (type === 'rag_search') return `知识库检索完成，命中 ${event?.hitCount ?? 0} 条`
  if (type === 'llm_input') return event?.stage === 'final_text' ? '把上下文发送给模型生成最终回复' : '把上下文发送给模型判断下一步'
  if (type === 'llm_decision') return `模型决定：${actionLabel(event?.action)}`
  if (type === 'tool_approval_requested') return `等待你确认受保护工具：${formatToolName(event?.tool)}`
  if (type === 'tool_approval_granted') return `你已确认执行：${formatToolName(event?.tool)}`
  if (type === 'tool_approval_denied') return `你已取消执行：${formatToolName(event?.tool)}`
  if (type === 'tool_approval_consumed') return `确认已用于执行：${formatToolName(event?.tool)}`
  if (type === 'mcp_call') return `开始调用 MCP 工具：${event?.tool || '(未知工具)'}`
  if (type === 'mcp_result') return `${statusLabel(event?.status) || '完成'} MCP 工具：${event?.tool || '(未知工具)'}`
  if (isSkillToolEvent(event) && type === 'tool_call' && mode === 'help') return `开始读取 Skill 说明：${skillName}`
  if (isSkillToolEvent(event) && type === 'tool_result' && mode === 'help') return `Skill 说明读取成功：${skillName}`
  if (isSkillToolEvent(event) && type === 'tool_call' && mode === 'run') return `开始激活 Skill：${skillName}`
  if (isSkillToolEvent(event) && type === 'tool_result' && mode === 'run') return `Skill 激活成功：${skillName}`
  if (type === 'tool_call') return `开始调用工具：${formatToolName(event?.tool)}`
  if (type === 'tool_result') return `${statusLabel(event?.status) || '完成'}工具：${formatToolName(event?.tool)}`
  if (type === 'llm_final_text') return '模型生成最终自然语言回复'
  if (type === 'ai_message') return '回复已保存到会话'
  if (type === 'system_action' && action === 'skill_help') return `Skill 说明已读取：${skillName}`
  if (type === 'system_action' && action === 'skill_run') return `Skill 已激活：${skillName}`
  if (type === 'system_action' && action === 'protected_tool_help') return `受保护工具说明已读取：${formatToolName(event?.tool)}`
  if (type === 'system_action' && action === 'protected_tool_run') return `受保护工具已执行：${formatToolName(event?.tool)}`
  if (type === 'system_action' && action === 'protected_tool_run_blocked') return `受保护工具被阻止：${formatToolName(event?.tool)}`
  if (type === 'system_action' && action === 'memory_compacted') return `短期记忆已压缩：压缩 ${event?.compressedTurnCount ?? event?.compressedMessageCount ?? 0} 轮，保留 ${event?.keptTurnCount ?? event?.keptMessageCount ?? 0} 轮`
  if (type === 'system_action' && action === 'user_profile_memory_updated') return '长期记忆已更新'
  if (type === 'system_action' && ACTION_LABELS[action]) return actionLabelText
  if (type === 'error') return `发生错误：${event?.scope || '系统'}`

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
  const action = String(event?.action || '').toLowerCase()
  const mode = skillMode(event)

  if (type === 'api_request') {
    return '前端或外部客户端访问了一个后端接口。这条记录用于追踪谁在什么时候触发了哪个入口。'
  }

  if (type === 'api_response') {
    return `后端接口处理完成，耗时 ${event?.durationMs ?? 0}ms。`
  }

  if (type === 'auth_success') {
    return `认证通过，来源：${event?.provider || 'local'}。`
  }

  if (type === 'auth_failure') {
    return '认证失败，没有发放访问 token。'
  }

  if (type === 'llm_decision') {
    return event?.thoughtSummary || event?.summary || ''
  }

  if (type === 'llm_input') {
    return event?.stage === 'final_text'
      ? '这表示 Agent 已经收集好上下文，正在请求模型生成最终自然语言回复。'
      : '这表示 Agent 把当前目标、记忆、工具结果等上下文发给模型，让模型判断下一步动作。'
  }

  if (type === 'llm_final_text') {
    return `最终回复长度：${event?.contentLength ?? 0} 字符。`
  }

  if (type === 'ai_message') {
    return `这条助手回复已经写入会话消息库。${event?.contentLength != null ? `长度 ${event.contentLength} 字符。` : ''}`
  }

  if (type === 'workspace_read') {
    return [
      event?.tool ? `来源工具：${event.tool}` : '',
      event?.sizeBytes != null ? `读取大小：${event.sizeBytes} 字节` : '',
      event?.matchCount != null ? `匹配数量：${event.matchCount}` : '',
      event?.entryCount != null ? `条目数量：${event.entryCount}` : '',
      event?.truncated ? '内容因为大小限制被截断。' : ''
    ].filter(Boolean).join('；')
  }

  if (type === 'workspace_write') {
    return `文件变更已记录。${event?.sizeBytes != null ? `当前大小 ${event.sizeBytes} 字节。` : ''}`
  }

  if (type === 'rag_search') {
    return event?.queryPreview
      ? `检索问题：${event.queryPreview}`
      : ''
  }

  if (type === 'tool_approval_requested') {
    const warnings = Array.isArray(event?.warnings) ? event.warnings.filter(Boolean).join('；') : ''
    return warnings || '这个工具调用不会立即执行，系统正在等待用户明确确认。'
  }

  if (type === 'tool_approval_granted') {
    return '用户已经确认，后端会按原始参数执行这次受保护工具调用。'
  }

  if (type === 'tool_approval_denied') {
    return '用户取消了这次受保护工具调用，后端不会执行它。'
  }

  if (type === 'tool_approval_consumed') {
    return '这条确认已经被用于一次真实工具执行，不能重复使用。'
  }

  if (type === 'mcp_call' || type === 'mcp_result') {
    return event?.summary || event?.message || ''
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

  if (type === 'system_action' && ACTION_EXPLANATIONS[action]) {
    return ACTION_EXPLANATIONS[action]
  }

  if (type === 'system_action' && Array.isArray(event?.changedFiles) && event.changedFiles.length) {
    return `涉及文件：${event.changedFiles.join('、')}`
  }

  if (type === 'error') {
    return event?.message || event?.error || ''
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
