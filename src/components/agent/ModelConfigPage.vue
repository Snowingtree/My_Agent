<template>
  <div class="model-config-page">
    <header class="model-config-header">
      <div class="model-config-header__copy">
        <h1>模型配置</h1>
        <p>配置 AI 模型、技能和 MCP 工具</p>
      </div>
      <div class="model-config-header__actions">
        <button
          type="button"
          class="secondary-btn"
          @click="$emit('back')"
        >
          ← 返回
        </button>
        <button
          type="button"
          class="primary-btn"
          :disabled="isSaving"
          @click="handleSave"
        >
          {{ isSaving ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </header>

    <div class="model-config-content">
      <div class="model-config-section">
        <div class="section-header">
          <h2>AI 模型配置</h2>
          <button
            type="button"
            class="add-config-btn"
            :disabled="isAddingConfig"
            @click="addNewConfig"
          >
            + 添加配置
          </button>
        </div>

        <div v-if="aiConfigs.length === 0 && !isLoading" class="empty-state">
          <p>暂无 AI 配置，点击"添加配置"开始创建</p>
        </div>

        <div v-if="isLoading" class="loading-state">
          <p>正在加载配置...</p>
        </div>

        <div v-if="aiConfigs.length > 0" class="config-list">
          <div
            v-for="(config, index) in aiConfigs"
            :key="config.aiId"
            class="config-card"
            :class="{ 'is-editing': editingConfig === config.aiId }"
          >
            <div v-if="editingConfig !== config.aiId" class="config-card__view">
              <div class="config-card__header">
                <div class="config-card__title">
                  <h3>{{ config.label || '未命名配置' }}</h3>
                  <span class="config-card__status" :class="config.enabled ? 'is-enabled' : 'is-disabled'">
                    {{ config.enabled ? '已启用' : '已禁用' }}
                  </span>
                </div>
                <div class="config-card__actions">
                  <button
                    type="button"
                    class="edit-btn"
                    @click="editConfig(config.aiId)"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    class="delete-btn"
                    @click="deleteConfig(config.aiId)"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div class="config-card__details">
                <div class="config-detail">
                  <label class="config-detail__label">AI 服务商</label>
                  <span class="config-detail__value">{{ config.provider || '未知' }}</span>
                </div>
                <div class="config-detail">
                  <label class="config-detail__label">基础 URL</label>
                  <span class="config-detail__value">{{ config.baseURL || '未设置' }}</span>
                </div>
                <div class="config-detail">
                  <label class="config-detail__label">API Key</label>
                  <span class="config-detail__value">{{ config.apiKey ? '●'.repeat(8) : '未设置' }}</span>
                </div>
                <div v-if="config.models && config.models.length > 0" class="config-detail">
                  <label class="config-detail__label">可用模型</label>
                  <div class="config-detail__models">
                    <span
                      v-for="model in config.models.slice(0, 3)"
                      :key="model"
                      class="model-tag"
                    >
                      {{ model }}
                    </span>
                    <span v-if="config.models.length > 3" class="model-tag more">
                      +{{ config.models.length - 3 }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="config-card__edit">
              <div class="form-grid">
                <div class="form-field">
                  <label class="form-label">配置名称 *</label>
                  <input
                    v-model="editingData.label"
                    type="text"
                    class="form-input"
                    placeholder="例如：OpenAI GPT-4"
                  />
                </div>

                <div class="form-field">
                  <label class="form-label">AI 服务商 *</label>
                  <select
                    v-model="editingData.provider"
                    class="form-select"
                  >
                    <option value="">请选择服务商</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>

                <div class="form-field">
                  <label class="form-label">基础 URL *</label>
                  <input
                    v-model="editingData.baseURL"
                    type="text"
                    class="form-input"
                    placeholder="https://api.openai.com/v1"
                  />
                </div>

                <div class="form-field">
                  <label class="form-label">API Key *</label>
                  <input
                    v-model="editingData.apiKey"
                    type="password"
                    class="form-input"
                    placeholder="输入 API 密钥"
                  />
                </div>

                <div class="form-field">
                  <label class="form-label">默认模型</label>
                  <input
                    v-model="editingData.defaultModel"
                    type="text"
                    class="form-input"
                    placeholder="gpt-4"
                  />
                </div>

                <div class="form-field">
                  <label class="form-label">温度 (Temperature)</label>
                  <input
                    v-model.number="editingData.temperature"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    class="form-input"
                    placeholder="0.7"
                  />
                </div>

                <div class="form-field">
                  <label class="form-label">系统提示词</label>
                  <textarea
                    v-model="editingData.systemPrompt"
                    class="form-textarea"
                    rows="3"
                    placeholder="设置系统行为偏好..."
                  />
                </div>

                <div class="form-field checkbox-field">
                  <label class="checkbox-label">
                    <input
                      v-model="editingData.enabled"
                      type="checkbox"
                    />
                    启用此配置
                  </label>
                </div>

                <div class="form-field checkbox-field">
                  <label class="checkbox-label">
                    <input
                      v-model="editingData.streamResponses"
                      type="checkbox"
                    />
                    启用流式响应
                  </label>
                </div>
              </div>

              <div class="config-card__edit-actions">
                <button
                  type="button"
                  class="secondary-btn"
                  @click="cancelEdit"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="primary-btn"
                  :disabled="!isEditingValid"
                  @click="saveConfig"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="model-config-section">
        <div class="section-header">
          <h2>技能配置</h2>
          <button
            type="button"
            class="add-config-btn"
            @click="showSkillDialog = true"
          >
            + 添加技能
          </button>
        </div>

        <div v-if="skills.length === 0" class="empty-state">
          <p>暂无技能配置，点击"添加技能"开始创建</p>
        </div>

        <div v-if="skills.length > 0" class="skills-list">
          <div
            v-for="skill in skills"
            :key="skill.skillId"
            class="skill-card"
          >
            <div class="skill-card__header">
              <div class="skill-card__title">
                <h3>{{ skill.name }}</h3>
                <span class="skill-card__id">{{ skill.skillId }}</span>
              </div>
              <div class="skill-card__status" :class="skill.enabled ? 'is-enabled' : 'is-disabled'">
                {{ skill.enabled ? '已启用' : '已禁用' }}
              </div>
            </div>

            <div class="skill-card__content">
              <p class="skill-card__description">{{ skill.description || '暂无描述' }}</p>

              <div v-if="skill.instruction" class="skill-card__instruction">
                <h4>指令</h4>
                <p>{{ skill.instruction }}</p>
              </div>

              <div class="skill-card__tools">
                <h4>工具配置</h4>
                <div class="tools-list">
                  <div
                    v-for="tool in (skill.preferredTools || [])"
                    :key="tool"
                    class="tool-tag"
                  >
                    {{ tool }}
                  </div>
                </div>
              </div>
            </div>

            <div class="skill-card__actions">
              <button
                type="button"
                class="edit-btn"
                @click="editSkill(skill)"
              >
                编辑
              </button>
              <button
                type="button"
                class="delete-btn"
                @click="deleteSkill(skill.skillId)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="model-config-section">
        <div class="section-header">
          <h2>MCP 工具配置</h2>
          <button
            type="button"
            class="add-config-btn"
            @click="showMcpDialog = true"
          >
            + 添加 MCP 工具
          </button>
        </div>

        <div v-if="mcpServers.length === 0" class="empty-state">
          <p>暂无 MCP 工具配置，点击"添加 MCP 工具"开始创建</p>
        </div>

        <div v-if="mcpServers.length > 0" class="mcp-list">
          <div
            v-for="mcp in mcpServers"
            :key="mcp.id"
            class="mcp-card"
          >
            <div class="mcp-card__header">
              <div class="mcp-card__title">
                <h3>{{ mcp.name }}</h3>
                <span class="mcp-card__status" :class="mcp.enabled ? 'is-enabled' : 'is-disabled'">
                  {{ mcp.enabled ? '已启用' : '已禁用' }}
                </span>
              </div>
            </div>

            <div class="mcp-card__content">
              <div class="mcp-detail">
                <label class="mcp-detail__label">服务器地址</label>
                <span class="mcp-detail__value">{{ mcp.url || '未设置' }}</span>
              </div>
              <div class="mcp-detail">
                <label class="mcp-detail__label">端口</label>
                <span class="mcp-detail__value">{{ mcp.port || '未设置' }}</span>
              </div>
            </div>

            <div class="mcp-card__actions">
              <button
                type="button"
                class="edit-btn"
                @click="editMcp(mcp.id)"
              >
                编辑
              </button>
              <button
                type="button"
                class="delete-btn"
                @click="deleteMcp(mcp.id)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 技能编辑对话框 -->
    <div v-if="showSkillDialog" class="modal-overlay" @click="closeSkillDialog">
      <div class="modal" @click.stop>
        <div class="modal__header">
          <h3>{{ editingSkill ? '编辑技能' : '添加技能' }}</h3>
          <button class="modal__close" @click="closeSkillDialog">×</button>
        </div>

        <div class="modal__content">
          <div class="form-grid">
            <div class="form-field">
              <label class="form-label">技能 ID *</label>
              <input
                v-model="skillForm.skillId"
                type="text"
                class="form-input"
                :disabled="!!editingSkill"
              />
            </div>

            <div class="form-field">
              <label class="form-label">技能名称 *</label>
              <input
                v-model="skillForm.name"
                type="text"
                class="form-input"
              />
            </div>

            <div class="form-field">
              <label class="form-label">描述</label>
              <input
                v-model="skillForm.description"
                type="text"
                class="form-input"
              />
            </div>

            <div class="form-field">
              <label class="form-label">指令</label>
              <textarea
                v-model="skillForm.instruction"
                class="form-textarea"
                rows="4"
              />
            </div>

            <div class="form-field">
              <label class="form-label">偏好工具（逗号分隔）</label>
              <input
                v-model="skillForm.preferredTools"
                type="text"
                class="form-input"
                placeholder="file_read, file_write, web_search"
              />
            </div>

            <div class="form-field">
              <label class="form-label">允许的工具（逗号分隔）</label>
              <input
                v-model="skillForm.allowedTools"
                type="text"
                class="form-input"
                placeholder="如果不设置，则无限制"
              />
            </div>

            <div class="form-field">
              <label class="form-label">禁用的工具（逗号分隔）</label>
              <input
                v-model="skillForm.disabledTools"
                type="text"
                class="form-input"
                placeholder="例如: dangerous_tool"
              />
            </div>

            <div class="form-field checkbox-field">
              <label class="checkbox-label">
                <input
                  v-model="skillForm.enabled"
                  type="checkbox"
                />
                启用此技能
              </label>
            </div>
          </div>
        </div>

        <div class="modal__actions">
          <button
            type="button"
            class="secondary-btn"
            @click="closeSkillDialog"
          >
            取消
          </button>
          <button
            type="button"
            class="primary-btn"
            :disabled="!isSkillFormValid"
            @click="saveSkill"
          >
            保存
          </button>
        </div>
      </div>
    </div>

    <!-- MCP 编辑对话框 -->
    <div v-if="showMcpDialog" class="modal-overlay" @click="closeMcpDialog">
      <div class="modal" @click.stop>
        <div class="modal__header">
          <h3>{{ editingMcp ? '编辑 MCP 工具' : '添加 MCP 工具' }}</h3>
          <button class="modal__close" @click="closeMcpDialog">×</button>
        </div>

        <div class="modal__content">
          <div class="form-grid">
            <div class="form-field">
              <label class="form-label">服务器名称 *</label>
              <input
                v-model="mcpForm.name"
                type="text"
                class="form-input"
              />
            </div>

            <div class="form-field">
              <label class="form-label">服务器地址 *</label>
              <input
                v-model="mcpForm.url"
                type="text"
                class="form-input"
                placeholder="http://localhost"
              />
            </div>

            <div class="form-field">
              <label class="form-label">端口 *</label>
              <input
                v-model.number="mcpForm.port"
                type="number"
                class="form-input"
                placeholder="8080"
              />
            </div>

            <div class="form-field">
              <label class="form-label">API 密钥</label>
              <input
                v-model="mcpForm.apiKey"
                type="password"
                class="form-input"
                placeholder="可选"
              />
            </div>

            <div class="form-field">
              <label class="form-label">超时时间（秒）</label>
              <input
                v-model.number="mcpForm.timeout"
                type="number"
                class="form-input"
                placeholder="30"
              />
            </div>

            <div class="form-field checkbox-field">
              <label class="checkbox-label">
                <input
                  v-model="mcpForm.enabled"
                  type="checkbox"
                />
                启用此 MCP 工具
              </label>
            </div>
          </div>
        </div>

        <div class="modal__actions">
          <button
            type="button"
            class="secondary-btn"
            @click="closeMcpDialog"
          >
            取消
          </button>
          <button
            type="button"
            class="primary-btn"
            :disabled="!isMcpFormValid"
            @click="saveMcp"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import http from '../../http.js'

const emit = defineEmits(['back', 'config-updated'])

// AI 配置相关
const aiConfigs = ref([])
const isLoading = ref(false)
const editingConfig = ref(null)
const editingData = ref({})
const isSaving = ref(false)

// 技能相关
const skills = ref([])
const showSkillDialog = ref(false)
const editingSkill = ref(null)
const skillForm = ref({
  skillId: '',
  name: '',
  description: '',
  instruction: '',
  preferredTools: '',
  allowedTools: '',
  disabledTools: '',
  enabled: true
})

// MCP 相关
const mcpServers = ref([])
const showMcpDialog = ref(false)
const editingMcp = ref(null)
const mcpForm = ref({
  id: '',
  name: '',
  url: '',
  port: 8080,
  apiKey: '',
  timeout: 30,
  enabled: true
})

// 计算属性
const isEditingValid = computed(() => {
  if (!editingData.value.label) return false
  if (!editingData.value.provider) return false
  if (!editingData.value.baseURL) return false
  if (!editingData.value.apiKey) return false
  return true
})

const isSkillFormValid = computed(() => {
  if (!skillForm.value.skillId) return false
  if (!skillForm.value.name) return false
  return true
})

const isMcpFormValid = computed(() => {
  if (!mcpForm.value.name) return false
  if (!mcpForm.value.url) return false
  if (!mcpForm.value.port) return false
  return true
})

// 方法
async function loadConfigs() {
  isLoading.value = true
  try {
    const response = await http.get('/api/ai-configs')
    aiConfigs.value = response || []
  } catch (error) {
    console.error('Failed to load AI configs:', error)
    aiConfigs.value = []
  } finally {
    isLoading.value = false
  }
}

function addNewConfig() {
  editingConfig.value = 'new'
  editingData.value = {
    label: '',
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    defaultModel: 'gpt-4',
    temperature: 0.7,
    systemPrompt: '',
    enabled: true,
    streamResponses: true,
    models: []
  }
}

function editConfig(aiId) {
  const config = aiConfigs.value.find(c => c.aiId === aiId)
  if (config) {
    editingConfig.value = aiId
    editingData.value = { ...config }
  }
}

function cancelEdit() {
  editingConfig.value = null
  editingData.value = {}
}

async function saveConfig() {
  if (!isEditingValid.value) return

  isSaving.value = true
  try {
    if (editingConfig.value === 'new') {
      // 创建新配置
      await http.post('/api/ai-configs', editingData.value)
    } else {
      // 更新现有配置
      await http.put(`/api/ai-configs/${editingConfig.value}`, editingData.value)
    }

    await loadConfigs()
    cancelEdit()
    emit('config-updated')
  } catch (error) {
    console.error('Failed to save config:', error)
  } finally {
    isSaving.value = false
  }
}

async function deleteConfig(aiId) {
  if (!confirm('确定要删除这个配置吗？')) return

  try {
    await http.delete(`/api/ai-configs/${aiId}`)
    await loadConfigs()
    emit('config-updated')
  } catch (error) {
    console.error('Failed to delete config:', error)
  }
}

// 技能相关方法
function editSkill(skill) {
  editingSkill.value = skill
  skillForm.value = {
    ...skill,
    preferredTools: (skill.preferredTools || []).join(', '),
    allowedTools: (skill.allowedTools || []).join(', '),
    disabledTools: (skill.disabledTools || []).join(', ')
  }
  showSkillDialog.value = true
}

async function saveSkill() {
  if (!isSkillFormValid.value) return

  const skillData = {
    ...skillForm.value,
    preferredTools: skillForm.value.preferredTools.split(',').map(t => t.trim()).filter(Boolean),
    allowedTools: skillForm.value.allowedTools.split(',').map(t => t.trim()).filter(Boolean),
    disabledTools: skillForm.value.disabledTools.split(',').map(t => t.trim()).filter(Boolean)
  }

  try {
    if (editingSkill.value) {
      await http.put(`/api/skills/${editingSkill.value.skillId}`, skillData)
    } else {
      await http.post('/api/skills', skillData)
    }

    await loadSkills()
    closeSkillDialog()
    emit('config-updated')
  } catch (error) {
    console.error('Failed to save skill:', error)
  }
}

function deleteSkill(skillId) {
  if (!confirm('确定要删除这个技能吗？')) return

  try {
    http.delete(`/api/skills/${skillId}`)
    loadSkills()
    emit('config-updated')
  } catch (error) {
    console.error('Failed to delete skill:', error)
  }
}

async function loadSkills() {
  try {
    const response = await http.get('/api/skills')
    skills.value = response || []
  } catch (error) {
    console.error('Failed to load skills:', error)
    skills.value = []
  }
}

function closeSkillDialog() {
  showSkillDialog.value = false
  editingSkill.value = null
  skillForm.value = {
    skillId: '',
    name: '',
    description: '',
    instruction: '',
    preferredTools: '',
    allowedTools: '',
    disabledTools: '',
    enabled: true
  }
}

// MCP 相关方法
function editMcp(mcpId) {
  const mcp = mcpServers.value.find(m => m.id === mcpId)
  if (mcp) {
    editingMcp.value = mcp
    mcpForm.value = { ...mcp }
    showMcpDialog.value = true
  }
}

async function saveMcp() {
  if (!isMcpFormValid.value) return

  const mcpData = { ...mcpForm.value }

  try {
    if (editingMcp.value) {
      await http.put(`/api/mcp-servers/${editingMcp.value.id}`, mcpData)
    } else {
      await http.post('/api/mcp-servers', mcpData)
    }

    await loadMcpServers()
    closeMcpDialog()
    emit('config-updated')
  } catch (error) {
    console.error('Failed to save MCP:', error)
  }
}

function deleteMcp(mcpId) {
  if (!confirm('确定要删除这个 MCP 工具吗？')) return

  try {
    http.delete(`/api/mcp-servers/${mcpId}`)
    loadMcpServers()
    emit('config-updated')
  } catch (error) {
    console.error('Failed to delete MCP:', error)
  }
}

async function loadMcpServers() {
  try {
    const response = await http.get('/api/mcp-servers')
    mcpServers.value = response || []
  } catch (error) {
    console.error('Failed to load MCP servers:', error)
    mcpServers.value = []
  }
}

function closeMcpDialog() {
  showMcpDialog.value = false
  editingMcp.value = null
  mcpForm.value = {
    id: '',
    name: '',
    url: '',
    port: 8080,
    apiKey: '',
    timeout: 30,
    enabled: true
  }
}

async function handleSave() {
  isSaving.value = true
  try {
    // 保存所有配置
    await Promise.all([
      loadConfigs(),
      loadSkills(),
      loadMcpServers()
    ])

    alert('配置保存成功！')
    emit('config-updated')
  } catch (error) {
    console.error('Failed to save all configs:', error)
  } finally {
    isSaving.value = false
  }
}

// 生命周期
onMounted(async () => {
  await Promise.all([
    loadConfigs(),
    loadSkills(),
    loadMcpServers()
  ])
})
</script>

<style scoped>
.model-config-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
}

.model-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
  padding-top: 24px;
}

.model-config-header__copy h1 {
  margin: 0 0 8px;
  font-size: 2rem;
  font-weight: 700;
  color: #171717;
}

.model-config-header__copy p {
  margin: 0;
  color: #6f6f6f;
  font-size: 1rem;
}

.model-config-header__actions {
  display: flex;
  gap: 12px;
}

.model-config-section {
  margin-bottom: 48px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.section-header h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #171717;
}

.add-config-btn {
  padding: 8px 16px;
  border: 1px solid #ececec;
  border-radius: 8px;
  background: #ffffff;
  color: #171717;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.add-config-btn:hover {
  background: #f5f5f5;
  border-color: #d9d9d9;
}

.config-list,
.skills-list,
.mcp-list {
  display: grid;
  gap: 16px;
}

.config-card,
.skill-card,
.mcp-card {
  border: 1px solid #ececec;
  border-radius: 16px;
  background: #ffffff;
  transition: all 0.15s ease;
}

.config-card:hover,
.skill-card:hover,
.mcp-card:hover {
  border-color: #d9d9d9;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.config-card__header,
.skill-card__header,
.mcp-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f5f5f5;
}

.config-card__title,
.skill-card__title,
.mcp-card__title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-card__title h3,
.skill-card__title h3,
.mcp-card__title h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #171717;
}

.config-card__status,
.skill-card__status,
.mcp-card__status {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 500;
}

.config-card__status.is-enabled,
.skill-card__status.is-enabled,
.mcp-card__status.is-enabled {
  background: rgba(53, 179, 107, 0.14);
  color: #227a48;
}

.config-card__status.is-disabled,
.skill-card__status.is-disabled,
.mcp-card__status.is-disabled {
  background: #f2f2f2;
  color: #565656;
}

.config-card__actions,
.skill-card__actions,
.mcp-card__actions {
  display: flex;
  gap: 8px;
}

.edit-btn,
.delete-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.edit-btn {
  background: #f5f5f5;
  color: #4a4a4a;
}

.edit-btn:hover {
  background: #e9e9e9;
}

.delete-btn {
  background: #fef2f2;
  color: #dc2626;
}

.delete-btn:hover {
  background: #fee2e2;
}

.config-card__details {
  padding: 20px;
}

.config-detail {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.config-detail__label {
  color: #6f6f6f;
  font-size: 0.9rem;
  font-weight: 500;
}

.config-detail__value {
  color: #171717;
  font-size: 0.9rem;
}

.config-detail__models {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.model-tag {
  padding: 4px 10px;
  border-radius: 6px;
  background: #f5f5f5;
  color: #4a4a4a;
  font-size: 0.85rem;
  font-weight: 500;
}

.model-tag.more {
  background: #e5e7eb;
  color: #6b7280;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-field.full-width {
  grid-column: 1 / -1;
}

.form-label {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: #4a4a4a;
}

.form-input,
.form-select,
.form-textarea {
  padding: 10px 14px;
  border: 1px solid #ececec;
  border-radius: 8px;
  background: #ffffff;
  font-size: 0.9rem;
  outline: none;
  transition: all 0.15s ease;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  border-color: #8ea9ff;
  box-shadow: 0 0 0 4px rgba(142, 169, 255, 0.1);
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox-label {
  font-size: 0.9rem;
  color: #4a4a4a;
  cursor: pointer;
}

.config-card__edit-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 20px;
  border-top: 1px solid #f5f5f5;
}

.skill-card__content,
.mcp-card__content {
  padding: 20px;
}

.skill-card__description {
  margin: 0 0 16px;
  color: #4a4a4a;
  line-height: 1.6;
}

.skill-card__instruction,
.skill-card__tools {
  margin-bottom: 16px;
}

.skill-card__instruction h4,
.skill-card__tools h4 {
  margin: 0 0 8px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #4a4a4a;
}

.skill-card__instruction p,
.skill-card__tools p {
  margin: 0;
  color: #171717;
  font-size: 0.9rem;
  line-height: 1.6;
}

.tools-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-tag {
  padding: 4px 10px;
  border-radius: 6px;
  background: #f0f7ff;
  color: #2563eb;
  font-size: 0.85rem;
  font-weight: 500;
}

.mcp-detail {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.mcp-detail__label {
  color: #6f6f6f;
  font-size: 0.9rem;
  font-weight: 500;
}

.mcp-detail__value {
  color: #171717;
  font-size: 0.9rem;
}

.empty-state,
.loading-state {
  padding: 60px 20px;
  text-align: center;
  color: #8a8a8a;
  font-size: 1rem;
  background: #fafafa;
  border-radius: 16px;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: #ffffff;
  border-radius: 16px;
  max-width: 600px;
  width: 90%;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #ececec;
}

.modal__header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #171717;
}

.modal__close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: #f5f5f5;
  color: #4a4a4a;
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal__close:hover {
  background: #e9e9e9;
}

.modal__content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.modal__actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 20px 24px;
  border-top: 1px solid #ececec;
}

.primary-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: #171717;
  color: #ffffff;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.primary-btn:hover:not(:disabled) {
  background: #000000;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-btn {
  padding: 10px 20px;
  border: 1px solid #ececec;
  border-radius: 8px;
  background: #ffffff;
  color: #4a4a4a;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.secondary-btn:hover {
  background: #f5f5f5;
  border-color: #d9d9d9;
}

@media (max-width: 768px) {
  .model-config-page {
    padding: 0 16px;
  }

  .model-config-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .config-detail,
  .mcp-detail {
    grid-template-columns: 1fr;
  }

  .config-card__detail__label,
  .mcp-detail__label {
    font-weight: 600;
  }
}
</style>