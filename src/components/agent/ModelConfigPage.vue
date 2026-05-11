<template>
  <div class="model-config-page">
    <header class="model-config-header">
      <div class="model-config-header__copy">
        <p class="model-config-header__eyebrow">设置中心</p>
        <h1>{{ activeSectionMeta.title }}</h1>
        <p class="model-config-header__desc">
          <span>{{ activeSectionMeta.description }}</span>
          <button
            v-if="props.activeSection === 'settings-ai'"
            type="button"
            class="primary-btn"
            @click="openAddAiModal"
          >
            添加接口
          </button>
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
          <article v-for="item in aiConfigs" :key="item.aiId" class="config-card config-card--ai">
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
  activeSection: { type: String, default: 'settings-ai' }
})

defineEmits(['back', 'config-updated'])

const aiConfigs = ref([])
const mcpServers = ref([])
const ragStatus = ref({})

const isLoadingAi = ref(false)
const isLoadingCapabilities = ref(false)
const isRefreshing = ref(false)

const aiError = ref('')
const capabilitiesError = ref('')

const showAddAiModal = ref(false)
const isSubmittingAi = ref(false)
const addAiError = ref('')
const addAiForm = ref({
  type: 'ai',
  name: '',
  aiVersions: '',
  aiBaseUrl: '',
  apiKey: ''
})

function openAddAiModal() {
  addAiForm.value = { type: 'ai', name: '', aiVersions: '', aiBaseUrl: '', apiKey: '' }
  addAiError.value = ''
  showAddAiModal.value = true
}

function closeAddAiModal() {
  showAddAiModal.value = false
  addAiError.value = ''
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
    description: '查看项目 skills 目录中的技能包说明文件，例如 description.md 和 SKILL.md。'
  },
  'settings-rag': {
    title: '知识库',
    description: '上传文档并写入 RAG 数据库，让 Agent 后续可以检索你的长期资料。'
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
    void ensureSectionLoaded(section, false)
  },
  { immediate: true }
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

@media (max-width: 1280px) {
  .config-grid--ai {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .config-grid--ai {
    grid-template-columns: minmax(0, 1fr);
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
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
