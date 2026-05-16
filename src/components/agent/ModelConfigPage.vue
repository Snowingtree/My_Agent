<template>
  <div class="model-config-page">
    <header class="model-config-header">
      <div class="model-config-header__copy">
        <p class="model-config-header__eyebrow">设置中心</p>
        <h1>{{ activeSectionMeta.title }}</h1>
        <p class="model-config-header__desc">
          <span>{{ activeSectionMeta.description }}</span>
          <span
            v-if="props.activeSection === 'settings-ai'"
            class="model-config-ai-actions"
          >
            <button type="button" class="secondary-btn" :class="{ 'is-active': isEditAiMode }" @click="toggleEditAiMode">
              {{ isEditAiMode ? '完成修改' : '修改配置' }}
            </button>
            <button type="button" class="primary-btn" @click="openAddAiModal">
              添加接口
            </button>
          </span>
          <span
            v-else-if="props.activeSection === 'settings-rag'"
            class="model-config-rag-status"
            :class="{ 'is-ready': ragStatus.ready, 'is-error': ragStatus.enabled && !ragStatus.ready }"
          >
            {{ ragStatus.ready ? '已连接数据库' : '数据库未连接' }}
          </span>
        </p>
      </div>

      <div class="model-config-header__actions">
        <button type="button" class="secondary-btn" :disabled="isRefreshing" @click="refreshActiveSection">
          {{ isRefreshing ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </header>

    <div class="model-config-content">
      <section v-if="props.activeSection === 'settings-ai'" class="model-config-section">
        <div v-if="isLoadingAi" class="model-config-state">正在读取 AI 配置...</div>
        <div v-else-if="aiError" class="model-config-state is-error">{{ aiError }}</div>
        <div v-else-if="!aiConfigs.length" class="model-config-state">当前没有可用的 AI 配置。</div>

        <div v-else class="config-grid config-grid--ai">
          <article
            v-for="item in aiConfigs"
            :key="item.aiId"
            class="config-card config-card--ai"
            :class="{ 'is-editable': isEditAiMode }"
            @click="openEditAiModal(item)"
          >
            <div class="config-card__head">
              <div class="config-card__title">
                <h3>{{ item.name || item.aiId }}</h3>
                <span class="config-type-chip" :class="getAiConfigType(item).className">
                  {{ getAiConfigType(item).label }}
                </span>
              </div>
              <span class="config-chip">{{ item.aiId }}</span>
            </div>
            <dl class="config-meta">
              <div>
                <dt>接口地址</dt>
                <dd>{{ item.aiBaseUrl || '未提供' }}</dd>
              </div>
              <div>
                <dt>模型列表</dt>
                <dd>{{ item.aiVersions || '未提供' }}</dd>
              </div>
              <div>
                <dt>API Key</dt>
                <dd>{{ item.hasApiKey ? '已配置' : '未配置' }}</dd>
              </div>
              <div v-if="getAiConfigType(item).className === 'is-embedding'">
                <dt>Chunk</dt>
                <dd>{{ formatChunkConfig(item) }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </section>

      <section v-else-if="props.activeSection === 'settings-mcp'" class="model-config-section">
        <div v-if="isLoadingCapabilities" class="model-config-state">正在读取 MCP 工具...</div>
        <div v-else-if="capabilitiesError" class="model-config-state is-error">{{ capabilitiesError }}</div>
        <div v-else-if="!mcpServers.length" class="model-config-state">当前没有可用的 MCP 服务。</div>

        <div v-else class="config-grid">
          <article v-for="item in mcpServers" :key="item.serverId" class="config-card">
            <div class="config-card__head">
              <h3>{{ item.name || item.serverId }}</h3>
              <span class="config-chip" :class="statusClass(item.status)">{{ formatStatus(item.status) }}</span>
            </div>
            <dl class="config-meta">
              <div>
                <dt>服务 ID</dt>
                <dd>{{ item.serverId }}</dd>
              </div>
              <div>
                <dt>工具前缀</dt>
                <dd>{{ item.toolNamePrefix || '未提供' }}</dd>
              </div>
              <div>
                <dt>工具数量</dt>
                <dd>{{ item.toolCount ?? 0 }}</dd>
              </div>
              <div>
                <dt>传输方式</dt>
                <dd>{{ item.transport || 'stdio' }}</dd>
              </div>
            </dl>
            <p v-if="item.error" class="config-error">{{ item.error }}</p>
          </article>
        </div>
      </section>

      <section v-else-if="props.activeSection === 'settings-agent-skills'" class="model-config-section">
        <SettingsSkillsExplorer />
      </section>

      <section v-else-if="props.activeSection === 'settings-rag'" class="model-config-section">
        <SettingsRagExplorer />
      </section>

      <section v-else-if="props.activeSection === 'settings-tools'" class="model-config-section">
        <SettingsToolsExplorer />
      </section>

      <section v-else-if="props.activeSection === 'settings-data-analysis'" class="model-config-section">
        <div v-if="isLoadingTokenUsage" class="model-config-state">正在读取 token 使用数据...</div>
        <div v-else-if="tokenUsageError" class="model-config-state is-error">{{ tokenUsageError }}</div>
        <div v-else class="analytics-panel">
          <div class="analytics-summary">
            <article>
              <span>总 Tokens</span>
              <strong>{{ formatNumber(tokenUsageSummary.totalTokens) }}</strong>
            </article>
            <article>
              <span>输入 Tokens</span>
              <strong>{{ formatNumber(tokenUsageSummary.inputTokens) }}</strong>
            </article>
            <article>
              <span>输出 Tokens</span>
              <strong>{{ formatNumber(tokenUsageSummary.outputTokens) }}</strong>
            </article>
            <article>
              <span>模型数量</span>
              <strong>{{ formatNumber(tokenUsageSummary.modelCount) }}</strong>
            </article>
          </div>

          <div class="analytics-table-wrap">
            <table class="analytics-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>类型</th>
                  <th>配置</th>
                  <th>消息数</th>
                  <th>输入 Tokens</th>
                  <th>输出 Tokens</th>
                  <th>总 Tokens</th>
                  <th>使用率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in tokenUsageRows" :key="item.key">
                  <td>{{ item.model || '未知模型' }}</td>
                  <td>
                    <span class="analytics-type-chip" :class="{ 'is-embedding': item.type === 'embedding' }">
                      {{ formatUsageType(item.type) }}
                    </span>
                  </td>
                  <td>{{ item.aiName || item.aiId || '未知配置' }}</td>
                  <td>{{ formatNumber(item.messageCount) }}</td>
                  <td>{{ formatNumber(item.inputTokens) }}</td>
                  <td>{{ formatNumber(item.outputTokens) }}</td>
                  <td>{{ formatNumber(item.totalTokens) }}</td>
                  <td>
                    <div class="analytics-ratio">
                      <span>{{ formatPercent(item.usageRate) }}</span>
                      <div>
                        <i :style="{ width: getUsageRateWidth(item.usageRate) }"></i>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr v-if="!tokenUsageRows.length">
                  <td colspan="8" class="analytics-table__empty">暂无 token 使用数据。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showAddAiModal" class="modal-overlay" @click.self="closeAddAiModal">
          <div class="modal-dialog">
            <div class="modal-header">
              <h2>添加 AI 接口</h2>
              <button type="button" class="modal-close" @click="closeAddAiModal">&times;</button>
            </div>
            <form class="modal-body" @submit.prevent="submitAddAi">
              <label class="modal-field">
                <span>配置类型</span>
                <select v-model="addAiForm.type">
                  <option value="ai">AI 配置</option>
                  <option value="embedding">embedding</option>
                </select>
              </label>
              <label class="modal-field">
                <span>名称</span>
                <input
                  v-model="addAiForm.name"
                  type="text"
                  placeholder="例如：MiMo、GPT-4"
                  required
                />
              </label>
              <label class="modal-field">
                <span>模型版本（用英文逗号 `,` 分隔）</span>
                <input
                  v-model="addAiForm.aiVersions"
                  type="text"
                  placeholder="例如：MiMo-7B-RL,MiMo-7B-SFT"
                />
              </label>
              <label class="modal-field">
                <span>接口地址</span>
                <input
                  v-model="addAiForm.aiBaseUrl"
                  type="text"
                  placeholder="例如：https://api.siliconflow.cn/v1"
                  required
                />
              </label>
              <label class="modal-field">
                <span>API Key</span>
                <input
                  v-model="addAiForm.apiKey"
                  type="password"
                  placeholder="请输入 API Key"
                  required
                />
              </label>
              <p v-if="addAiError" class="modal-error">{{ addAiError }}</p>
              <div class="modal-footer">
                <button type="button" class="secondary-btn" @click="closeAddAiModal">取消</button>
                <button type="submit" class="primary-btn" :disabled="isSubmittingAi">
                  {{ isSubmittingAi ? '提交中...' : '确认添加' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
      <Transition name="modal-fade">
        <div v-if="showEditAiModal" class="modal-overlay" @click.self="closeEditAiModal">
          <div class="modal-dialog">
            <div class="modal-header">
              <h2>修改 AI 配置</h2>
              <button type="button" class="modal-close" @click="closeEditAiModal">&times;</button>
            </div>
            <form class="modal-body" @submit.prevent="submitEditAi">
              <label class="modal-field">
                <span>名称</span>
                <input v-model="editAiForm.name" type="text" required />
              </label>
              <label class="modal-field">
                <span>模型版本（英文逗号分割）</span>
                <input v-model="editAiForm.aiVersions" type="text" />
              </label>
              <label class="modal-field">
                <span>接口地址</span>
                <input v-model="editAiForm.aiBaseUrl" type="text" required />
              </label>
              <div class="modal-field">
                <span>API Key</span>
                <input type="password" value="********" disabled />
              </div>
              <template v-if="editAiForm.type === 'embedding'">
                <label class="modal-field">
                  <span>Chunk 最大字符数</span>
                  <input v-model="editAiForm.chunkMaxChars" type="number" min="300" max="8000" placeholder="默认使用全局配置" />
                </label>
                <label class="modal-field">
                  <span>Chunk 重叠字符数</span>
                  <input v-model="editAiForm.chunkOverlapChars" type="number" min="0" placeholder="默认使用全局配置" />
                </label>
              </template>
              <p v-if="editAiError" class="modal-error">{{ editAiError }}</p>
              <div class="modal-footer">
                <button type="button" class="secondary-btn" @click="closeEditAiModal">取消</button>
                <button type="submit" class="primary-btn" :disabled="isSubmittingEditAi">
                  {{ isSubmittingEditAi ? '保存中...' : '保存修改' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import http from '../../http.js'
import SettingsRagExplorer from './SettingsRagExplorer.vue'
import SettingsSkillsExplorer from './SettingsSkillsExplorer.vue'
import SettingsToolsExplorer from './SettingsToolsExplorer.vue'

const props = defineProps({
  activeSection: { type: String, default: 'settings-ai' },
  isActive: { type: Boolean, default: true }
})

defineEmits(['back', 'config-updated'])

const aiConfigs = ref([])
const mcpServers = ref([])
const ragStatus = ref({})
const tokenUsageRows = ref([])
const tokenUsageSummary = ref({
  modelCount: 0,
  messageCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0
})

const isLoadingAi = ref(false)
const isLoadingCapabilities = ref(false)
const isLoadingTokenUsage = ref(false)
const isRefreshing = ref(false)

const aiError = ref('')
const capabilitiesError = ref('')
const tokenUsageError = ref('')

const showAddAiModal = ref(false)
const showEditAiModal = ref(false)
const isEditAiMode = ref(false)
const isSubmittingAi = ref(false)
const isSubmittingEditAi = ref(false)
const addAiError = ref('')
const editAiError = ref('')
const addAiForm = ref({
  type: 'ai',
  name: '',
  aiVersions: '',
  aiBaseUrl: '',
  apiKey: ''
})
const editAiForm = ref({
  aiId: '',
  type: 'ai',
  name: '',
  aiVersions: '',
  aiBaseUrl: '',
  chunkMaxChars: '',
  chunkOverlapChars: ''
})

function toggleEditAiMode() {
  isEditAiMode.value = !isEditAiMode.value
}

function resetEditAiMode() {
  isEditAiMode.value = false
  closeEditAiModal()
}

function openAddAiModal() {
  addAiForm.value = { type: 'ai', name: '', aiVersions: '', aiBaseUrl: '', apiKey: '' }
  addAiError.value = ''
  showAddAiModal.value = true
}

function closeAddAiModal() {
  showAddAiModal.value = false
  addAiError.value = ''
}

function openEditAiModal(item) {
  if (!isEditAiMode.value) {
    return
  }

  editAiForm.value = {
    aiId: item.aiId || '',
    type: getAiConfigType(item).className === 'is-embedding' ? 'embedding' : 'ai',
    name: item.name || '',
    aiVersions: item.aiVersions || '',
    aiBaseUrl: item.aiBaseUrl || '',
    chunkMaxChars: item.chunkMaxChars || '',
    chunkOverlapChars: item.chunkOverlapChars || ''
  }
  editAiError.value = ''
  showEditAiModal.value = true
}

function closeEditAiModal() {
  showEditAiModal.value = false
  editAiError.value = ''
}

async function submitEditAi() {
  editAiError.value = ''
  isSubmittingEditAi.value = true

  try {
    await http.put(`/api/ai/configs/${encodeURIComponent(editAiForm.value.aiId)}`, {
      name: editAiForm.value.name,
      aiVersions: editAiForm.value.aiVersions,
      aiBaseUrl: editAiForm.value.aiBaseUrl,
      chunkMaxChars: editAiForm.value.type === 'embedding' ? editAiForm.value.chunkMaxChars : null,
      chunkOverlapChars: editAiForm.value.type === 'embedding' ? editAiForm.value.chunkOverlapChars : null
    })

    closeEditAiModal()
    await loadAiConfigs()
  } catch (error) {
    editAiError.value = error instanceof Error ? error.message : '修改失败，请重试。'
  } finally {
    isSubmittingEditAi.value = false
  }
}

async function submitAddAi() {
  addAiError.value = ''
  isSubmittingAi.value = true

  try {
    await http.post('/api/ai/configs', {
      type: addAiForm.value.type,
      name: addAiForm.value.name,
      aiVersions: addAiForm.value.aiVersions,
      aiBaseUrl: addAiForm.value.aiBaseUrl,
      apiKey: addAiForm.value.apiKey
    })

    closeAddAiModal()
    await loadAiConfigs()
  } catch (error) {
    addAiError.value = error instanceof Error ? error.message : '添加失败，请重试。'
  } finally {
    isSubmittingAi.value = false
  }
}

const SECTION_META = {
  'settings-ai': {
    title: 'AI 配置',
    description: '查看当前可用的模型配置、接口地址和模型列表。'
  },
  'settings-mcp': {
    title: 'MCP',
    description: '查看已接入的 MCP 服务、状态和工具数量。'
  },
  'settings-agent-skills': {
    title: 'Skills',
    description: '查看项目 skills 目录中的技能 Markdown 文件。'
  },
  'settings-rag': {
    title: '知识库',
    description: '上传文档并写入 RAG 数据库，让 Agent 后续可以检索你的长期资料。'
  },
  'settings-data-analysis': {
    title: '数据分析',
    description: '查看不同模型的 token 使用量和占比。'
  },
  'settings-tools': {
    title: '工具',
    description: '查看当前 Agent 可用工具，以及每个工具对应的实现源码。'
  }
}

const activeSectionMeta = computed(() => {
  return SECTION_META[props.activeSection] || SECTION_META['settings-ai']
})

function statusClass(status) {
  const normalizedStatus = String(status || '').trim().toLowerCase()

  if (normalizedStatus === 'ready') {
    return 'is-ready'
  }

  if (normalizedStatus === 'error') {
    return 'is-error'
  }

  if (normalizedStatus === 'disabled') {
    return 'is-disabled'
  }

  return 'is-pending'
}

function formatStatus(status) {
  const normalizedStatus = String(status || '').trim().toLowerCase()

  if (normalizedStatus === 'ready') {
    return '正常'
  }

  if (normalizedStatus === 'error') {
    return '异常'
  }

  if (normalizedStatus === 'disabled') {
    return '已禁用'
  }

  return '连接中'
}

function getAiConfigType(item) {
  const explicitType = [
    item?.type,
    item?.configType,
    item?.aiType,
    item?.kind,
    item?.usage
  ]
    .map((value) => String(value || '').toLowerCase())
    .find(Boolean)

  if (explicitType && (explicitType.includes('embedding') || explicitType.includes('embed') || explicitType.includes('vector'))) {
    return {
      label: 'embedding',
      className: 'is-embedding'
    }
  }

  const sourceText = [
    item?.name,
    item?.aiId,
    item?.aiVersions,
    item?.aiBaseUrl
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')

  if (
    sourceText.includes('embedding')
    || sourceText.includes('embed')
    || sourceText.includes('向量')
    || sourceText.includes('vector')
  ) {
    return {
      label: 'embedding',
      className: 'is-embedding'
    }
  }

  return {
    label: 'AI配置',
    className: 'is-ai'
  }
}

function formatChunkConfig(item) {
  const maxChars = item?.chunkMaxChars || '全局'
  const overlapChars = item?.chunkOverlapChars || '全局'
  return `${maxChars} / ${overlapChars}`
}

async function loadAiConfigs() {
  isLoadingAi.value = true
  aiError.value = ''

  try {
    const response = await http.get('/api/ai/configs')
    aiConfigs.value = Array.isArray(response?.items) ? response.items : []
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : '读取 AI 配置失败。'
    aiConfigs.value = []
  } finally {
    isLoadingAi.value = false
  }
}

async function loadCapabilities() {
  isLoadingCapabilities.value = true
  capabilitiesError.value = ''

  try {
    const response = await http.get('/api/agent/capabilities')
    mcpServers.value = Array.isArray(response?.mcpServers) ? response.mcpServers : []
  } catch (error) {
    capabilitiesError.value = error instanceof Error ? error.message : '读取 MCP 能力失败。'
    mcpServers.value = []
  } finally {
    isLoadingCapabilities.value = false
  }
}

async function loadRagStatus() {
  try {
    ragStatus.value = await http.get('/api/agent/rag/status')
  } catch (error) {
    ragStatus.value = {
      enabled: true,
      ready: false,
      error: error instanceof Error ? error.message : '读取知识库状态失败。'
    }
  }
}

async function loadTokenUsage() {
  isLoadingTokenUsage.value = true
  tokenUsageError.value = ''

  try {
    const response = await http.get('/api/agent/analytics/token-usage')
    tokenUsageRows.value = Array.isArray(response?.items) ? response.items : []
    tokenUsageSummary.value = {
      modelCount: Number(response?.summary?.modelCount || 0),
      messageCount: Number(response?.summary?.messageCount || 0),
      inputTokens: Number(response?.summary?.inputTokens || 0),
      outputTokens: Number(response?.summary?.outputTokens || 0),
      totalTokens: Number(response?.summary?.totalTokens || 0)
    }
  } catch (error) {
    tokenUsageError.value = error instanceof Error ? error.message : '读取 token 使用数据失败。'
    tokenUsageRows.value = []
  } finally {
    isLoadingTokenUsage.value = false
  }
}

function formatNumber(value) {
  const normalizedValue = Number(value || 0)
  return Number.isFinite(normalizedValue) ? new Intl.NumberFormat('zh-CN').format(normalizedValue) : '0'
}

function formatPercent(value) {
  const normalizedValue = Number(value || 0)
  return `${(Number.isFinite(normalizedValue) ? normalizedValue * 100 : 0).toFixed(1)}%`
}

function formatUsageType(value) {
  return String(value || '').toLowerCase() === 'embedding' ? 'Embedding' : 'AI'
}

function getUsageRateWidth(value) {
  const normalizedValue = Number(value || 0)
  const percent = Number.isFinite(normalizedValue) ? Math.max(0, Math.min(100, normalizedValue * 100)) : 0
  return `${percent}%`
}

async function ensureSectionLoaded(section, force = false) {
  if (section === 'settings-ai') {
    if (force || (!aiConfigs.value.length && !isLoadingAi.value)) {
      await loadAiConfigs()
    }
    return
  }

  if (section === 'settings-mcp') {
    if (force || (!mcpServers.value.length && !isLoadingCapabilities.value)) {
      await loadCapabilities()
    }
    return
  }

  if (section === 'settings-rag') {
    if (force || !Object.keys(ragStatus.value || {}).length) {
      await loadRagStatus()
    }
  }

  if (section === 'settings-data-analysis') {
    if (force || (!tokenUsageRows.value.length && !isLoadingTokenUsage.value)) {
      await loadTokenUsage()
    }
  }
}

async function refreshActiveSection() {
  isRefreshing.value = true

  try {
    await ensureSectionLoaded(props.activeSection, true)
  } finally {
    isRefreshing.value = false
  }
}

watch(
  () => props.activeSection,
  (section) => {
    if (section !== 'settings-ai') {
      resetEditAiMode()
    }

    void ensureSectionLoaded(section, false)
  },
  { immediate: true }
)

watch(
  () => props.isActive,
  (isActive) => {
    if (!isActive) {
      resetEditAiMode()
    }
  }
)
</script>

<style scoped>
.model-config-page {
  max-width: 1320px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.model-config-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto auto;
  gap: 24px;
  row-gap: 8px;
  margin-bottom: 24px;
}

.model-config-header__copy {
  display: contents;
}

.model-config-header__eyebrow {
  grid-column: 1;
  grid-row: 1;
  margin: 0;
  color: #7a869f;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.model-config-header__copy h1 {
  grid-column: 1;
  grid-row: 2;
  margin: 0;
  color: #171717;
  font-size: 2rem;
  font-weight: 700;
}

.model-config-header__desc {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  grid-column: 1 / -1;
  grid-row: 3;
  width: 100%;
  margin: 0;
  color: #5d667a;
  font-size: 0.98rem;
  line-height: 1.7;
}

.model-config-header__desc > span:first-child {
  flex: 1;
  min-width: 0;
}

.model-config-rag-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 38px;
  padding: 0 15px;
  border-radius: 999px;
  background: #fff7ed;
  color: #9a3412;
  font-weight: 800;
  white-space: nowrap;
}

.model-config-rag-status.is-ready {
  background: #dcfce7;
  color: #087443;
}

.model-config-rag-status.is-error {
  background: #fff1f2;
  color: #be123c;
}

.model-config-ai-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}

.model-config-header__actions {
  grid-column: 2;
  grid-row: 1 / 3;
  display: flex;
  align-items: center;
  gap: 12px;
  justify-self: end;
}

.model-config-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.model-config-section {
  min-height: 0;
  animation: settings-section-switch-in 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.model-config-section:last-child {
  height: 100%;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}

.config-grid--ai {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.config-card {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid #e7ebf3;
  border-radius: 20px;
  background: #ffffff;
}

.config-card--ai.is-editable {
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.config-card--ai.is-editable:hover {
  border-color: #9bbcff;
  box-shadow:
    inset 0 0 0 1px #9bbcff,
    0 16px 36px rgba(37, 99, 235, 0.12);
  transform: none;
}

.config-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.config-card__head h3 {
  margin: 0;
  color: #171717;
  font-size: 1.04rem;
  font-weight: 700;
}

.config-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.config-card__title h3 {
  min-width: 0;
}

.config-type-chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 7px;
  font-size: 0.74rem;
  font-weight: 800;
}

.config-type-chip.is-ai {
  background: #eaf3ff;
  color: #2563eb;
}

.config-type-chip.is-embedding {
  background: #e8f8ef;
  color: #16834a;
}

.config-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: #eef3fb;
  color: #46618e;
  font-size: 0.8rem;
  font-weight: 700;
}

.config-chip.is-ready {
  background: rgba(53, 179, 107, 0.14);
  color: #227a48;
}

.config-chip.is-error {
  background: rgba(209, 76, 62, 0.12);
  color: #a6382c;
}

.config-chip.is-disabled {
  background: #f2f2f2;
  color: #666666;
}

.config-chip.is-pending {
  background: rgba(77, 120, 255, 0.12);
  color: #3259b6;
}

.config-meta {
  display: grid;
  gap: 12px;
  margin: 0;
}

.config-meta div {
  display: grid;
  gap: 4px;
}

.config-meta dt {
  color: #7b8498;
  font-size: 0.8rem;
  font-weight: 700;
}

.config-meta dd {
  margin: 0;
  color: #1f2a3d;
  line-height: 1.6;
  word-break: break-word;
}

.config-card--ai .config-meta div:nth-child(1) dd,
.config-card--ai .config-meta div:nth-child(2) dd {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: normal;
}

.config-description,
.config-error {
  margin: 0;
  line-height: 1.7;
}

.config-description {
  color: #3d4657;
}

.config-error {
  color: #b33d34;
}

.config-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.config-tag {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: #eef5ff;
  color: #2757bf;
  font-size: 0.78rem;
  font-weight: 600;
}

.config-tag.is-allowed {
  background: #edf9f1;
  color: #287248;
}

.config-tag.is-blocked {
  background: #fdf0ef;
  color: #a6382c;
}

.config-footnote {
  margin: 0;
  color: #667085;
  font-size: 0.84rem;
  line-height: 1.7;
}

.analytics-panel {
  display: grid;
  gap: 18px;
}

.analytics-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.analytics-summary article {
  display: grid;
  gap: 8px;
  padding: 18px;
  border: 1px solid #e7ebf3;
  border-radius: 18px;
  background: #ffffff;
}

.analytics-summary span {
  color: #7b8498;
  font-size: 0.82rem;
  font-weight: 700;
}

.analytics-summary strong {
  color: #171717;
  font-size: 1.55rem;
  line-height: 1.1;
}

.analytics-table-wrap {
  overflow: auto;
  border: 1px solid #e7ebf3;
  border-radius: 20px;
  background: #ffffff;
}

.analytics-table {
  width: 100%;
  min-width: 900px;
  border-collapse: separate;
  border-spacing: 0;
  background: #ffffff;
}

.analytics-table th,
.analytics-table td {
  padding: 15px 18px;
  border-bottom: 1px solid #edf1f7;
  text-align: left;
  white-space: nowrap;
}

.analytics-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8fafc;
  color: #667085;
  font-size: 0.78rem;
  font-weight: 800;
}

.analytics-table td {
  color: #1f2a3d;
  font-size: 0.9rem;
}

.analytics-table tbody tr:hover {
  background: #f3f4f6;
}

.analytics-table tbody tr:last-child td {
  border-bottom: 0;
}

.analytics-table__empty {
  color: #7b8498;
  text-align: center;
}

.analytics-type-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: #eaf3ff;
  color: #2563eb;
  font-size: 0.74rem;
  font-weight: 800;
}

.analytics-type-chip.is-embedding {
  background: #e8f8ef;
  color: #16834a;
}

.analytics-ratio {
  display: grid;
  grid-template-columns: 54px minmax(120px, 1fr);
  align-items: center;
  gap: 10px;
}

.analytics-ratio span {
  color: #1f2a3d;
  font-weight: 700;
}

.analytics-ratio div {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #eef2f7;
}

.analytics-ratio i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #93c5fd, #22c55e);
}

@media (max-width: 1280px) {
  .config-grid--ai {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analytics-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .config-grid--ai {
    grid-template-columns: minmax(0, 1fr);
  }

  .analytics-summary {
    grid-template-columns: minmax(0, 1fr);
  }
}

@keyframes settings-section-switch-in {
  0% {
    opacity: 0;
    transform: translateY(10px);
  }

  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.model-config-state {
  padding: 22px;
  border: 1px solid #e7ebf3;
  border-radius: 18px;
  background: #ffffff;
  color: #697287;
  line-height: 1.7;
}

.model-config-state.is-error {
  color: #b33d34;
}

.secondary-btn {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid #dfe5f1;
  border-radius: 12px;
  background: #ffffff;
  color: #364153;
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
}

.secondary-btn:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}

.secondary-btn.is-active {
  border-color: #111827;
  background: #111827;
  color: #ffffff;
}

.primary-btn {
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 12px;
  background: rgb(125, 125, 125);
  color: #ffffff;
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
}

.primary-btn:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.5s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(2px);
}

.modal-dialog {
  width: 480px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #eef1f6;
}

.modal-header h2 {
  margin: 0;
  color: #171717;
  font-size: 1.2rem;
  font-weight: 700;
}

.modal-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #7a869f;
  font-size: 1.4rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  background: #f4f7fc;
}

.modal-body {
  display: grid;
  gap: 18px;
  padding: 24px;
}

.modal-field {
  display: grid;
  gap: 6px;
}

.modal-field span {
  color: #364153;
  font-size: 0.88rem;
  font-weight: 600;
}

.modal-field input,
.modal-field select {
  height: 42px;
  padding: 0 14px;
  border: 1px solid #dfe5f1;
  border-radius: 10px;
  background: #f9fbfd;
  color: #171717;
  font: inherit;
  font-size: 0.92rem;
  outline: none;
  transition: border-color 0.16s ease;
}

.modal-field input:focus,
.modal-field select:focus {
  border-color: rgb(125, 125, 125);
}

.modal-error {
  margin: 0;
  color: #b33d34;
  font-size: 0.86rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 6px;
}

@media (max-width: 960px) {
  .model-config-page {
    padding: 18px;
  }

  .model-config-header {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    margin-bottom: 16px;
  }

  .model-config-header__copy {
    display: grid;
    gap: 6px;
  }

  .model-config-header__eyebrow,
  .model-config-header__copy h1,
  .model-config-header__desc,
  .model-config-header__actions {
    grid-column: auto;
    grid-row: auto;
  }

  .model-config-header__copy h1 {
    font-size: 1.5rem;
  }

  .model-config-header__desc {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
    font-size: 0.9rem;
  }

  .model-config-header__actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .model-config-ai-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .model-config-ai-actions button,
  .model-config-header__actions button {
    flex: 1 1 150px;
  }
}

@media (max-width: 640px) {
  .model-config-page {
    padding: 12px;
  }

  .model-config-header {
    gap: 10px;
  }

  .model-config-header__copy h1 {
    font-size: 1.28rem;
  }

  .model-config-rag-status {
    width: fit-content;
    min-height: 32px;
    padding: 0 12px;
    font-size: 0.82rem;
  }

  .config-grid,
  .config-grid--ai {
    grid-template-columns: minmax(0, 1fr);
  }

  .config-card {
    padding: 16px;
    border-radius: 18px;
  }
}
</style>
