<template>
  <div class="model-config-page">
    <header class="model-config-header">
      <div class="model-config-header__copy">
        <p class="model-config-header__eyebrow">设置中心</p>
        <h1>{{ activeSectionMeta.title }}</h1>
        <p>{{ activeSectionMeta.description }}</p>
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

        <div v-else class="config-grid">
          <article v-for="item in aiConfigs" :key="item.aiId" class="config-card">
            <div class="config-card__head">
              <h3>{{ item.name || item.aiId }}</h3>
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

      <section v-else-if="props.activeSection === 'settings-skills'" class="model-config-section">
        <div v-if="isLoadingSkills" class="model-config-state">正在读取技能配置...</div>
        <div v-else-if="skillsError" class="model-config-state is-error">{{ skillsError }}</div>
        <div v-else-if="!skills.length" class="model-config-state">当前没有技能配置。</div>

        <div v-else class="config-grid">
          <article v-for="item in skills" :key="item.skillId" class="config-card">
            <div class="config-card__head">
              <h3>{{ item.name || item.skillId }}</h3>
              <span class="config-chip">{{ item.skillId }}</span>
            </div>
            <p class="config-description">{{ item.description || '暂无描述。' }}</p>
            <div class="config-tags">
              <span v-for="tool in item.preferredTools || []" :key="`${item.skillId}-preferred-${tool}`" class="config-tag">
                优先：{{ tool }}
              </span>
              <span v-for="tool in item.allowedTools || []" :key="`${item.skillId}-allowed-${tool}`" class="config-tag is-allowed">
                可用：{{ tool }}
              </span>
              <span v-for="tool in item.disabledTools || []" :key="`${item.skillId}-disabled-${tool}`" class="config-tag is-blocked">
                禁用：{{ tool }}
              </span>
            </div>
            <div v-if="item.instruction" class="config-instruction">
              <strong>指令</strong>
              <p>{{ item.instruction }}</p>
            </div>
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

      <section v-else-if="props.activeSection === 'settings-tools'" class="model-config-section">
        <SettingsToolsExplorer />
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import http from '../../http.js'
import SettingsToolsExplorer from './SettingsToolsExplorer.vue'

const props = defineProps({
  activeSection: { type: String, default: 'settings-ai' }
})

defineEmits(['back', 'config-updated'])

const aiConfigs = ref([])
const skills = ref([])
const mcpServers = ref([])

const isLoadingAi = ref(false)
const isLoadingSkills = ref(false)
const isLoadingCapabilities = ref(false)
const isRefreshing = ref(false)

const aiError = ref('')
const skillsError = ref('')
const capabilitiesError = ref('')

const SECTION_META = {
  'settings-ai': {
    title: 'AI 配置',
    description: '查看当前可用的模型配置、接口地址和模型列表。'
  },
  'settings-skills': {
    title: '技能配置',
    description: '查看当前 Agent 已注册的技能、指令和工具偏好。'
  },
  'settings-mcp': {
    title: 'MCP 工具',
    description: '查看已接入的 MCP 服务、状态和工具数量。'
  },
  'settings-tools': {
    title: '工具 Tool',
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

async function loadSkills() {
  isLoadingSkills.value = true
  skillsError.value = ''

  try {
    const response = await http.get('/api/agent/skills')
    skills.value = Array.isArray(response?.items) ? response.items : []
  } catch (error) {
    skillsError.value = error instanceof Error ? error.message : '读取技能配置失败。'
    skills.value = []
  } finally {
    isLoadingSkills.value = false
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

async function refreshActiveSection() {
  isRefreshing.value = true

  try {
    if (props.activeSection === 'settings-ai') {
      await loadAiConfigs()
      return
    }

    if (props.activeSection === 'settings-skills') {
      await loadSkills()
      return
    }

    if (props.activeSection === 'settings-mcp') {
      await loadCapabilities()
      return
    }
  } finally {
    isRefreshing.value = false
  }
}

onMounted(async () => {
  await Promise.all([
    loadAiConfigs(),
    loadSkills(),
    loadCapabilities()
  ])
})
</script>

<style scoped>
.model-config-page {
  max-width: 1320px;
  margin: 0 auto;
  padding: 24px;
}

.model-config-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.model-config-header__copy {
  display: grid;
  gap: 8px;
}

.model-config-header__eyebrow {
  margin: 0;
  color: #7a869f;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.model-config-header__copy h1 {
  margin: 0;
  color: #171717;
  font-size: 2rem;
  font-weight: 700;
}

.model-config-header__copy p:last-child {
  margin: 0;
  color: #5d667a;
  font-size: 0.98rem;
  line-height: 1.7;
}

.model-config-header__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.model-config-content {
  min-height: 0;
}

.model-config-section {
  min-height: 0;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
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

.config-instruction {
  display: grid;
  gap: 6px;
}

.config-instruction strong {
  color: #5f6880;
  font-size: 0.82rem;
}

.config-instruction p {
  margin: 0;
  color: #30394b;
  line-height: 1.7;
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
