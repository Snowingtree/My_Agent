<template>
  <main class="agent-page">
    <aside class="agent-page__sidebar">
      <div class="agent-sidebar__top">
        <button
          type="button"
          class="agent-sidebar__brand"
          :class="{ 'is-active': showHomePage }"
          :aria-label="showHomePage ? '返回对话' : '打开主页'"
          :title="showHomePage ? '返回对话' : '打开主页'"
          @click="toggleHomePage"
        >
          <span class="agent-user-card__avatar">{{ userInitial }}</span>
          <div>
            <strong>Agent</strong>
            <small>{{ username }}</small>
          </div>
        </button>

        <div class="agent-sidebar__top-actions">
          <button
            type="button"
            class="agent-sidebar__icon-button"
            :class="{ 'is-active': showModelConfig }"
            :aria-label="showModelConfig ? '返回对话' : '打开设置'"
            :title="showModelConfig ? '返回对话' : '打开设置'"
            @click="toggleSettings"
          >
            <svg v-if="showModelConfig" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M10 6L4 12L10 18"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
              <path
                d="M5 12H14C17.314 12 20 14.686 20 18"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M10.325 4.317C10.751 2.561 13.249 2.561 13.675 4.317C13.95 5.454 15.229 5.991 16.243 5.44C17.81 4.589 19.577 6.355 18.726 7.923C18.175 8.936 18.712 10.216 19.849 10.49C21.605 10.917 21.605 13.414 19.849 13.84C18.712 14.115 18.175 15.394 18.726 16.408C19.577 17.975 17.81 19.742 16.243 18.891C15.229 18.34 13.95 18.877 13.675 20.014C13.249 21.77 10.751 21.77 10.325 20.014C10.05 18.877 8.771 18.34 7.757 18.891C6.19 19.742 4.423 17.975 5.274 16.408C5.825 15.394 5.288 14.115 4.151 13.84C2.395 13.414 2.395 10.917 4.151 10.49C5.288 10.216 5.825 8.936 5.274 7.923C4.423 6.355 6.19 4.589 7.757 5.44C8.771 5.991 10.05 5.454 10.325 4.317Z"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.6"
              />
              <circle
                cx="12"
                cy="12"
                r="3.25"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
              />
            </svg>
          </button>
        </div>
      </div>

      <div class="agent-sidebar-rail">
        <div
          class="agent-sidebar-rail__track"
          :class="{
            'is-home-open': showHomePage,
            'is-settings-open': showModelConfig
          }"
        >
          <section class="agent-sidebar-rail__panel agent-sidebar-rail__panel--chat">
            <button
              type="button"
              class="agent-sidebar__new-chat"
              :disabled="isCreatingSession"
              @click="createSession"
            >
              <span class="agent-sidebar__new-chat-icon">+</span>
              <span>{{ isCreatingSession ? '创建中...' : '新建对话' }}</span>
            </button>

            <div class="agent-sidebar__section">
              <div class="agent-sidebar__section-head">
                <span>最近对话</span>
                <small>{{ sessions.length }}</small>
              </div>

              <div class="agent-session-list">
                <div class="agent-session-list__body">
                  <p v-if="sessionError" class="form-error agent-session-list__status">{{ sessionError }}</p>
                  <p v-else-if="isLoadingSessions" class="agent-session-list__status">正在读取会话列表...</p>
                  <p v-else-if="!sessions.length" class="agent-session-list__status agent-session-list__status--empty">
                    还没有会话，先开始第一轮对话。
                  </p>

                  <div v-else class="agent-session-list__items">
                    <article
                      v-for="item in sessions"
                      :key="item.sessionId"
                      class="agent-session-item"
                      :class="{ 'is-active': item.sessionId === activeSessionId }"
                    >
                      <button
                        type="button"
                        class="agent-session-item__main"
                        @click="selectSession(item.sessionId)"
                      >
                        <span class="agent-session-item__title">{{ item.title }}</span>
                      </button>

                      <button
                        type="button"
                        class="agent-session-item__delete"
                        title="删除会话"
                        aria-label="删除会话"
                        @click="deleteSession(item.sessionId)"
                      >
                        <span aria-hidden="true">•••</span>
                      </button>
                    </article>
                  </div>
                </div>
              </div>
            </div>

            <div class="agent-sidebar__footer">
              <button type="button" class="agent-sidebar__logout" @click="$emit('logout')">
                退出登录
              </button>
            </div>
          </section>

          <section class="agent-sidebar-rail__panel agent-sidebar-rail__panel--home">
            <div class="agent-settings-sidebar__offset" aria-hidden="true"></div>

            <div class="agent-sidebar__section">
              <div class="agent-sidebar__section-head">
                <span>主页导航</span>
              </div>

              <div class="agent-settings-nav">
                <button
                  type="button"
                  class="agent-settings-nav__item"
                  :class="{ 'is-active': activeHomeSection === 'home-profile' }"
                  @click="selectHomeSection('home-profile')"
                >
                  个人画像
                </button>
              </div>
            </div>
          </section>

          <section class="agent-sidebar-rail__panel agent-sidebar-rail__panel--settings">
            <div class="agent-settings-sidebar__offset" aria-hidden="true"></div>

            <div class="agent-sidebar__section">
              <div class="agent-sidebar__section-head">
                <span>设置导航</span>
              </div>

              <div class="agent-settings-nav">
                <button
                  type="button"
                  class="agent-settings-nav__item"
                  :class="{ 'is-active': activeSettingsSection === 'settings-ai' }"
                  @click="selectSettingsSection('settings-ai')"
                >
                  AI 配置
                </button>
                <button
                  type="button"
                  class="agent-settings-nav__item"
                  :class="{ 'is-active': activeSettingsSection === 'settings-mcp' }"
                  @click="selectSettingsSection('settings-mcp')"
                >
                  MCP
                </button>
                <button
                  type="button"
                  class="agent-settings-nav__item"
                  :class="{ 'is-active': activeSettingsSection === 'settings-agent-skills' }"
                  @click="selectSettingsSection('settings-agent-skills')"
                >
                  Skills
                </button>
                <button
                  type="button"
                  class="agent-settings-nav__item"
                  :class="{ 'is-active': activeSettingsSection === 'settings-rag' }"
                  @click="selectSettingsSection('settings-rag')"
                >
                  知识库
                </button>
                <button
                  type="button"
                  class="agent-settings-nav__item"
                  :class="{ 'is-active': activeSettingsSection === 'settings-tools' }"
                  @click="selectSettingsSection('settings-tools')"
                >
                  工具
                </button>
                <button
                  type="button"
                  class="agent-settings-nav__item"
                  :class="{ 'is-active': activeSettingsSection === 'settings-audit' }"
                  @click="selectSettingsSection('settings-audit')"
                >
                  审计监控
                </button>
                <button
                  type="button"
                  class="agent-settings-nav__item"
                  :class="{ 'is-active': activeSettingsSection === 'settings-data-analysis' }"
                  @click="selectSettingsSection('settings-data-analysis')"
                >
                  数据分析
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </aside>

    <section
      class="agent-page__content"
      :class="{
        'is-home-open': showHomePage,
        'is-settings-open': showModelConfig
      }"
    >
      <section
        class="agent-page__stage agent-page__stage--workspace"
        :aria-hidden="showHomePage || showModelConfig ? 'true' : 'false'"
      >
        <AgentWorkspace
          :ephemeral-attachments="activeEphemeralAttachments"
          :expired-attachment-notice="expiredAttachmentNotice"
          :active-session-id="activeSessionId"
          :active-session-title="activeSession?.title || '新对话'"
          :context-memory-summary="activeSession?.memorySummary || ''"
          :context-memory-config="contextMemoryConfig"
          :context-message-count="activeSession?.messages?.length || 0"
          :active-workspace-files="activeWorkspaceFiles"
          :active-workspace-folder="activeWorkspaceFolder"
          :ai-configs="aiConfigs"
          :embedding-configs="embeddingConfigs"
          :can-send="canSend"
          :chat-error="chatError"
          :draft="draft"
          :hide-sidebar="true"
          :is-agent-running="isAgentRunning"
          :is-cancelling-task="isCancellingTask"
          :is-creating-session="isCreatingSession"
          :is-loading-ai-configs="isLoadingAiConfigs"
          :is-loading-lark-chats="isLoadingLarkChats"
          :is-loading-mcp-servers="isLoadingMcpServers"
          :is-loading-skills="isLoadingSkills"
          :is-loading-session="isLoadingSession"
          :is-loading-sessions="isLoadingSessions"
          :is-loading-workspace-file="isLoadingWorkspaceFile"
          :is-refreshing-active-session="isRefreshingActiveSession"
          :is-sending="isSending"
          :load-error="loadError"
          :lark-chat-error="larkChatError"
          :lark-chats="larkChats"
          :mcp-server-error="mcpServerError"
          :mcp-servers="mcpServers"
          :messages="activeMessages"
          :model-options="modelOptions"
          :selected-agent-label="selectedAgentLabel"
          :selected-ai-id="selectedAiId"
          :selected-model="selectedModel"
          :selected-model-label="selectedModelLabel"
          :selected-mcp-server-ids="selectedMcpServerIds"
          :selected-mcp-server-label="selectedMcpServerLabel"
          :selected-lark-chat-id="selectedLarkChatId"
          :selected-lark-chat-label="selectedLarkChatLabel"
          :selected-rag-collection-id="selectedRagCollectionId"
          :selected-rag-collection-ids="selectedRagCollectionIds"
          :selected-rag-collection-label="selectedRagCollectionLabel"
          :selected-embedding-ai-id="selectedEmbeddingAiId"
          :selected-skill-ids="selectedSkillIds"
          :selected-skill-label="selectedSkillLabel"
          :rag-collections="ragCollections"
          :rag-collection-error="ragCollectionError"
          :skills="skills"
          :selected-workspace-file-content="selectedWorkspaceFileContent"
          :selected-workspace-file-path="selectedWorkspaceFilePath"
          :selected-workspace-file-size-bytes="selectedWorkspaceFileSizeBytes"
          :selected-workspace-file-updated-at="selectedWorkspaceFileUpdatedAt"
          :session-error="sessionError"
          :sessions="sessions"
          :task="currentTask"
          :username="username"
          :workspace-file-error="workspaceFileError"
          :workspace-mode="workspaceMode"
          @cancel-task="cancelActiveTask"
          @close-workspace-file="closeWorkspaceFile"
          @dismiss-expired-attachment-notice="dismissExpiredAttachmentNotice"
          @open-workspace-file="openWorkspaceFile"
          @remove-ephemeral-attachment="removeEphemeralAttachment"
          @refresh-lark-chats="refreshLarkChats"
          @refresh-mcp-servers="refreshMcpServers"
          @refresh-session="refreshActiveSession"
          @select-lark-chat="selectLarkChat"
          @send="sendMessage"
          @upload-attachments="addEphemeralAttachments"
          @update:ai-id="setSelectedAiId"
          @update:draft="draft = $event"
          @update:lark-chat-id="setSelectedLarkChatId"
          @update:mcp-server-ids="setSelectedMcpServerIds"
          @update:model="setSelectedModel"
          @update:rag-collection-id="setSelectedRagCollectionId"
          @update:rag-collection-ids="setSelectedRagCollectionIds"
          @update:embedding-ai-id="setSelectedEmbeddingAiId"
          @update:skill-ids="setSelectedSkillIds"
        />
      </section>

      <section class="agent-page__stage agent-page__stage--home" :aria-hidden="showHomePage ? 'false' : 'true'">
        <section class="agent-home-content">
          <header class="agent-home-header">
            <h1>{{ activeHomeTitle }}</h1>
            <p>{{ activeHomeDescription }}</p>
          </header>

          <section class="agent-home-panel agent-home-profile">
            <div class="agent-home-profile__toolbar">
              <div>
                <span class="agent-home-panel__eyebrow">Long-Term Memory</span>
                <h2>长期个人画像</h2>
              </div>
              <button
                type="button"
                class="agent-home-profile__refresh"
                :disabled="isLoadingUserProfile"
                @click="loadUserProfile"
              >
                {{ isLoadingUserProfile ? '刷新中...' : '刷新' }}
              </button>
            </div>

            <p v-if="userProfileError" class="agent-home-profile__status agent-home-profile__status--error">
              {{ userProfileError }}
            </p>
            <p v-else-if="isLoadingUserProfile" class="agent-home-profile__status">
              正在读取长期记忆...
            </p>
            <div v-else-if="userProfileSections.length" class="agent-home-profile__content">
              <article
                v-for="section in userProfileSections"
                :key="section.sectionId"
                class="agent-home-profile__section"
              >
                <header class="agent-home-profile__section-head">
                  <span>{{ section.kicker }}</span>
                  <h3>{{ section.title }}</h3>
                </header>

                <div class="agent-home-profile__blocks">
                  <template v-for="block in section.blocks" :key="block.blockId">
                    <p v-if="block.type === 'paragraph'" class="agent-home-profile__paragraph">
                      {{ block.text }}
                    </p>
                    <ul v-else-if="block.type === 'list'" class="agent-home-profile__list">
                      <li v-for="item in block.items" :key="item.itemId">
                        {{ item.text }}
                      </li>
                    </ul>
                  </template>
                </div>
              </article>
            </div>
            <div v-else class="agent-home-profile__empty">
              <h2>暂无个人画像</h2>
              <p>当你在对话中说“以后回答先说结论”“请记住我的偏好”等稳定偏好后，这里会显示长期记忆内容。</p>
            </div>
          </section>
        </section>
      </section>

      <section class="agent-page__stage agent-page__stage--settings" :aria-hidden="showModelConfig ? 'false' : 'true'">
        <section class="agent-settings-content">
          <ModelConfigPage
            :active-section="activeSettingsSection"
            :is-active="showModelConfig"
            @back="closeModelConfig"
          />
        </section>
      </section>
    </section>
  </main>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { createMessage } from 'snowingress-my-components'
import { getAgentUsername } from '../auth.js'
import http from '../http.js'
import { useAgentWorkspace } from '../useAgentWorkspace.js'
import AgentWorkspace from './agent/AgentWorkspace/AgentWorkspace.vue'
import ModelConfigPage from './agent/ModelConfigPage.vue'

defineEmits(['logout'])

const activeSurface = ref('chat')
const showModelConfig = computed(() => activeSurface.value === 'settings')
const showHomePage = computed(() => activeSurface.value === 'home')
const activeHomeSection = ref('home-profile')
const activeSettingsSection = ref('settings-ai')
const isLoadingUserProfile = ref(false)
const userProfileError = ref('')
const userProfileText = ref('')

const activeHomeTitle = computed(() => '个人画像')
const activeHomeDescription = computed(() => '展示 Agent 已学习的长期偏好和稳定个人上下文。')
const userProfileSections = computed(() => parseUserProfileMarkdown(userProfileText.value))

function stripMarkdownInline(value) {
  return String(value || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

function parseUserProfileMarkdown(value) {
  const lines = String(value || '').split(/\r?\n/)
  const sections = []
  let currentSection = null
  let blockIndex = 0
  let itemIndex = 0

  const createSection = (title = '个人画像', level = 2) => {
    const section = {
      sectionId: `profile-section-${sections.length + 1}`,
      title: stripMarkdownInline(title) || '个人画像',
      kicker: level <= 1 ? 'Profile' : `Section ${sections.length + 1}`,
      blocks: []
    }
    sections.push(section)
    currentSection = section
    return section
  }

  const ensureSection = () => currentSection || createSection()

  const addParagraph = (text) => {
    const section = ensureSection()
    section.blocks.push({
      blockId: `profile-block-${blockIndex += 1}`,
      type: 'paragraph',
      text
    })
  }

  const addListItem = (text) => {
    const section = ensureSection()
    const lastBlock = section.blocks[section.blocks.length - 1]

    if (lastBlock?.type === 'list') {
      lastBlock.items.push({
        itemId: `profile-item-${itemIndex += 1}`,
        text
      })
      return
    }

    section.blocks.push({
      blockId: `profile-block-${blockIndex += 1}`,
      type: 'list',
      items: [{
        itemId: `profile-item-${itemIndex += 1}`,
        text
      }]
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line || /^-{3,}$/.test(line)) {
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)

    if (headingMatch) {
      createSection(headingMatch[2], headingMatch[1].length)
      continue
    }

    const listMatch = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/)

    if (listMatch) {
      addListItem(stripMarkdownInline(listMatch[1]))
      continue
    }

    addParagraph(stripMarkdownInline(line))
  }

  return sections
    .map((section) => ({
      ...section,
      blocks: section.blocks.filter((block) => (
        block.type === 'list'
          ? block.items.length
          : Boolean(block.text)
      ))
    }))
    .filter((section) => section.blocks.length)
}

function notify({ message, type = 'success', duration = 3000 }) {
  createMessage({
    message,
    type,
    duration,
    offset: 24
  })
}

function openModelConfig() {
  activeSurface.value = 'settings'
  activeSettingsSection.value = activeSettingsSection.value || 'settings-ai'
}

function closeModelConfig() {
  activeSurface.value = 'chat'
}

function openHomePage() {
  activeSurface.value = 'home'
  activeHomeSection.value = 'home-profile'
}

function closeHomePage() {
  activeSurface.value = 'chat'
}

function toggleHomePage() {
  if (showHomePage.value) {
    closeHomePage()
    return
  }

  openHomePage()
}

function toggleSettings() {
  if (showModelConfig.value) {
    closeModelConfig()
    return
  }

  openModelConfig()
}

function selectSettingsSection(sectionId) {
  activeSettingsSection.value = sectionId
  activeSurface.value = 'settings'
}

function selectHomeSection(sectionId) {
  activeHomeSection.value = sectionId
  activeSurface.value = 'home'
}

async function loadUserProfile() {
  isLoadingUserProfile.value = true
  userProfileError.value = ''

  try {
    const response = await http.get('/api/agent/memory/profile')
    userProfileText.value = String(response?.profile || '').trim()
  } catch (error) {
    userProfileError.value = error instanceof Error ? error.message : '读取个人画像失败。'
  } finally {
    isLoadingUserProfile.value = false
  }
}

watch(
  () => [showHomePage.value, activeHomeSection.value],
  ([isHomeOpen, section]) => {
    if (isHomeOpen && section === 'home-profile') {
      void loadUserProfile()
    }
  }
)

const username = ref(getAgentUsername({ storage: localStorage }))
const userInitial = computed(() => {
  const value = String(username.value || '').trim()
  return value ? value.charAt(0).toUpperCase() : 'A'
})

const {
  activeEphemeralAttachments,
  activeMessages,
  activeSession,
  activeSessionId,
  contextMemoryConfig,
  activeWorkspaceFiles,
  activeWorkspaceFolder,
  addEphemeralAttachments,
  aiConfigs,
  embeddingConfigs,
  skills,
  cancelActiveTask,
  canSend,
  chatError,
  closeWorkspaceFile,
  createSession,
  currentTask,
  deleteSession,
  dismissExpiredAttachmentNotice,
  draft,
  expiredAttachmentNotice,
  isCancellingTask,
  isAgentRunning,
  isCreatingSession,
  isLoadingAiConfigs,
  isLoadingLarkChats,
  isLoadingMcpServers,
  isLoadingSkills,
  isLoadingSession,
  isLoadingSessions,
  isLoadingWorkspaceFile,
  isRefreshingActiveSession,
  isSending,
  loadError,
  larkChatError,
  larkChats,
  mcpServerError,
  mcpServers,
  modelOptions,
  openWorkspaceFile,
  ragCollectionError,
  ragCollections,
  refreshLarkChats,
  refreshMcpServers,
  refreshActiveSession,
  removeEphemeralAttachment,
  selectSession,
  selectLarkChat,
  selectedAgentLabel,
  selectedAiId,
  selectedModel,
  selectedModelLabel,
  selectedMcpServerIds,
  selectedMcpServerLabel,
  selectedLarkChatId,
  selectedLarkChatLabel,
  selectedRagCollectionId,
  selectedRagCollectionIds,
  selectedRagCollectionLabel,
  selectedEmbeddingAiId,
  selectedSkillIds,
  selectedSkillLabel,
  selectedWorkspaceFileContent,
  selectedWorkspaceFilePath,
  selectedWorkspaceFileSizeBytes,
  selectedWorkspaceFileUpdatedAt,
  sendMessage,
  sessionError,
  sessions,
  setSelectedAiId,
  setSelectedLarkChatId,
  setSelectedMcpServerIds,
  setSelectedRagCollectionId,
  setSelectedRagCollectionIds,
  setSelectedEmbeddingAiId,
  setSelectedSkillIds,
  setSelectedModel,
  workspaceFileError,
  workspaceMode
} = useAgentWorkspace({
  storage: localStorage,
  notify,
  confirmDelete: () => window.confirm('确认删除这个 Agent 会话吗？')
})
</script>

<style scoped>
.agent-page {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  height: 100dvh;
  min-height: 100dvh;
  background: #ffffff;
  overflow: hidden;
}

.agent-page__sidebar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px;
  overflow: hidden;
  border-right: 1px solid #ececec;
  background: #f7f7f8;
}

.agent-sidebar__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 6px 8px;
}

.agent-sidebar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 4px 6px 4px 2px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    background-color 150ms ease,
    transform 150ms ease;
}

.agent-sidebar__brand:hover,
.agent-sidebar__brand.is-active {
  background: #ececec;
}

.agent-sidebar__brand strong,
.agent-sidebar__brand small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-sidebar__brand strong {
  color: #171717;
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.2;
}

.agent-sidebar__brand small {
  max-width: 164px;
  margin-top: 2px;
  color: #6f6f6f;
  font-size: 0.78rem;
}

.agent-user-card__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #171717;
  color: #ffffff;
  font-size: 0.8rem;
  font-weight: 700;
}

.agent-sidebar__icon-button,
.agent-sidebar__new-chat,
.agent-session-item__main,
.agent-session-item__delete,
.agent-sidebar__logout,
.agent-settings-nav__item {
  border: 0;
  font: inherit;
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    opacity 150ms ease,
    transform 150ms ease;
}

.agent-sidebar__icon-button {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: transparent;
  color: #303030;
  cursor: pointer;
  line-height: 1;
}

.agent-sidebar__top-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.agent-sidebar__icon-button:hover,
.agent-sidebar__icon-button.is-active,
.agent-sidebar__new-chat:hover,
.agent-sidebar__logout:hover {
  background: #ececec;
}

.agent-sidebar__icon-button svg {
  width: 18px;
  height: 18px;
}

.agent-sidebar-rail {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.agent-sidebar-rail__track {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  width: 300%;
  height: 100%;
  transform: translateX(0);
  transition: transform 760ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.agent-sidebar-rail__track.is-home-open {
  transform: translateX(-33.333333%);
}

.agent-sidebar-rail__track.is-settings-open {
  transform: translateX(-66.666667%);
}

.agent-sidebar-rail__panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 8px;
  padding-right: 10px;
}

.agent-sidebar-rail__panel--home,
.agent-sidebar-rail__panel--settings {
  padding-right: 0;
  padding-left: 10px;
}

.agent-sidebar__new-chat {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 42px;
  padding: 9px 10px;
  border-radius: 10px;
  background: transparent;
  color: #202020;
  cursor: pointer;
  text-align: left;
  font-size: 0.94rem;
}

.agent-sidebar__new-chat:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.agent-sidebar__new-chat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  color: #5f5f5f;
  font-size: 1.1rem;
  line-height: 1;
}

.agent-sidebar__section {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
}

.agent-sidebar__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 4px;
  color: #8a8a8a;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.agent-sidebar__section-head small {
  color: #a3a3a3;
  font-size: 0.72rem;
}

.agent-session-list,
.agent-session-list__body,
.agent-session-list__items {
  min-height: 0;
}

.agent-session-list {
  flex: 1;
}

.agent-session-list__body {
  display: grid;
  gap: 8px;
  height: 100%;
}

.agent-session-list__items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.agent-session-list__items::-webkit-scrollbar {
  width: 8px;
}

.agent-session-list__items::-webkit-scrollbar-thumb {
  border: 2px solid #f7f7f8;
  border-radius: 999px;
  background: #d1d1d1;
}

.agent-session-list__status {
  margin: 0 4px;
  padding: 10px;
  color: #777777;
  font-size: 0.92rem;
  line-height: 1.6;
}

.agent-session-list__status--empty {
  border-radius: 12px;
  background: #ededed;
}

.agent-session-item {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 0;
  align-items: center;
  min-height: 40px;
  border-radius: 10px;
  background: transparent;
  transition:
    background-color 0.24s ease,
    box-shadow 0.24s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-session-item.is-active {
  background: #e7e7e7;
  animation: sidebar-nav-active-pop 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-session-item__main {
  width: 100%;
  min-height: 40px;
  padding: 0 10px 0 12px;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.agent-session-item__delete {
  width: 34px;
  height: 34px;
  margin-right: 2px;
  border-radius: 10px;
  background: transparent;
  color: #666666;
  cursor: pointer;
}

.agent-session-item__delete:hover,
.agent-session-item__main:hover,
.agent-settings-nav__item:hover {
  background: #ececec;
  transform: translateX(2px);
}

.agent-session-item__title {
  display: block;
  overflow: hidden;
  color: #202020;
  font-size: 0.94rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-sidebar__footer {
  padding-top: 8px;
  border-top: 1px solid #e6e6e6;
}

.agent-sidebar__logout {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 10px;
  background: transparent;
  color: #3a3a3a;
  cursor: pointer;
  text-align: left;
}

.agent-settings-sidebar__offset {
  min-height: 42px;
}

.agent-settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}

.agent-settings-nav__item {
  position: relative;
  overflow: hidden;
  width: 100%;
  min-height: 40px;
  border-radius: 10px;
  background: transparent;
  color: #2b2b2b;
  cursor: pointer;
  font-size: 0.94rem;
  font-weight: 500;
  text-align: left;
  padding: 0 10px 0 12px;
  transition:
    background-color 0.24s ease,
    color 0.24s ease,
    box-shadow 0.24s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-settings-nav__item.is-active {
  background: #e7e7e7;
  color: #202020;
  animation: sidebar-nav-active-pop 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-page__content {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #ffffff;
}

.agent-page__stage {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  transition: opacity 1000ms ease;
  will-change: opacity;
}

.agent-page__stage--workspace {
  z-index: 2;
  opacity: 1;
}

.agent-page__stage--settings {
  z-index: 1;
  opacity: 0;
  pointer-events: none;
}

.agent-page__stage--home {
  z-index: 1;
  opacity: 0;
  pointer-events: none;
}

.agent-page__content.is-home-open .agent-page__stage--workspace,
.agent-page__content.is-settings-open .agent-page__stage--workspace {
  opacity: 0;
  pointer-events: none;
}

.agent-page__content.is-home-open .agent-page__stage--home,
.agent-page__content.is-settings-open .agent-page__stage--settings {
  z-index: 3;
  opacity: 1;
  pointer-events: auto;
}

.agent-home-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  padding: 28px;
  overflow: hidden;
  background: #f6f8fb;
}

.agent-home-header,
.agent-home-panel {
  border: 1px solid #e7ebf3;
  border-radius: 22px;
  background: #ffffff;
}

.agent-home-header {
  flex: 0 0 auto;
  padding: 18px 22px;
}

.agent-home-header h1,
.agent-home-header p,
.agent-home-panel h2,
.agent-home-panel p {
  margin: 0;
}

.agent-home-header h1 {
  color: #171717;
  font-size: 1.7rem;
}

.agent-home-header p {
  margin-top: 8px;
  color: #667085;
  font-size: 0.92rem;
  line-height: 1.7;
}

.agent-home-panel {
  flex: 1;
  min-height: 0;
  padding: 24px;
  overflow: hidden;
}

.agent-home-panel__body {
  display: grid;
  place-items: start;
  align-content: center;
  gap: 10px;
  height: 100%;
  border: 1px dashed #d8dee9;
  border-radius: 18px;
  background:
    radial-gradient(circle at 12% 18%, rgba(59, 130, 246, 0.08), transparent 28%),
    linear-gradient(135deg, #fbfcff 0%, #f6f8fb 100%);
  padding: 28px;
}

.agent-home-panel__eyebrow {
  color: #667085;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-home-panel h2 {
  color: #171717;
  font-size: 1.3rem;
}

.agent-home-panel p {
  max-width: 560px;
  color: #667085;
  line-height: 1.8;
}

.agent-home-profile {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.agent-home-profile__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: 0 0 auto;
}

.agent-home-profile__toolbar h2 {
  margin: 6px 0 0;
  color: #171717;
  font-size: 1.24rem;
}

.agent-home-profile__refresh {
  height: 38px;
  border: 1px solid #d8dee9;
  border-radius: 999px;
  background: #ffffff;
  color: #344054;
  cursor: pointer;
  font-weight: 700;
  padding: 0 16px;
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
}

.agent-home-profile__refresh:hover:not(:disabled) {
  border-color: #b9c2d2;
  background: #f8fafc;
  transform: translateY(-1px);
}

.agent-home-profile__refresh:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.agent-home-profile__status,
.agent-home-profile__empty {
  margin: 0;
  border: 1px dashed #d8dee9;
  border-radius: 18px;
  background: #fbfcff;
  color: #667085;
  padding: 22px;
}

.agent-home-profile__status--error {
  border-color: #fecaca;
  background: #fff7f7;
  color: #b42318;
}

.agent-home-profile__empty {
  display: grid;
  align-content: center;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.agent-home-profile__empty h2,
.agent-home-profile__empty p {
  margin: 0;
}

.agent-home-profile__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 14px;
  border: 1px solid #e7ebf3;
  border-radius: 18px;
  background:
    radial-gradient(circle at 12% 8%, rgba(14, 165, 233, 0.08), transparent 30%),
    linear-gradient(180deg, #fbfdff 0%, #f7f9fc 100%);
  padding: 18px;
}

.agent-home-profile__section {
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
  padding: 18px;
}

.agent-home-profile__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}

.agent-home-profile__section-head span {
  order: 2;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #eff6ff;
  color: #2563eb;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 5px 9px;
  text-transform: uppercase;
}

.agent-home-profile__section-head h3 {
  margin: 0;
  color: #111827;
  font-size: 1.05rem;
  line-height: 1.35;
}

.agent-home-profile__blocks {
  display: grid;
  gap: 10px;
}

.agent-home-profile__paragraph {
  margin: 0;
  color: #475467;
  font-size: 0.94rem;
  line-height: 1.8;
}

.agent-home-profile__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.agent-home-profile__list li {
  position: relative;
  padding-left: 18px;
  color: #344054;
  font-size: 0.94rem;
  line-height: 1.7;
}

.agent-home-profile__list li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.72em;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #38bdf8;
  box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.12);
}

.agent-settings-content {
  height: 100%;
  overflow: hidden;
  background: #f6f8fb;
  display: flex;
  flex-direction: column;
}

@keyframes sidebar-nav-active-pop {
  0% {
    opacity: 0.72;
    transform: translateX(-6px) scale(0.985);
  }

  100% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@media (max-width: 1180px) {
  .agent-page {
    grid-template-columns: 280px minmax(0, 1fr);
  }
}

@media (max-width: 920px) {
  .agent-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .agent-page__sidebar {
    max-height: 42dvh;
    border-right: 0;
    border-bottom: 1px solid #ececec;
  }

  .agent-sidebar-rail {
    max-height: calc(42dvh - 68px);
  }

  .agent-page__content {
    min-height: 0;
  }

  .agent-home-content {
    padding: 14px;
    gap: 12px;
  }

  .agent-home-header {
    padding: 14px 16px;
    border-radius: 18px;
  }

  .agent-home-header h1 {
    font-size: 1.28rem;
  }

  .agent-home-panel {
    border-radius: 18px;
  }

  .agent-home-panel__body {
    padding: 26px;
  }
}

@media (max-width: 640px) {
  .agent-page__sidebar {
    max-height: 36dvh;
    padding: 8px;
  }

  .agent-sidebar__top {
    padding: 2px 2px 6px;
  }

  .agent-sidebar__brand small {
    display: none;
  }

  .agent-sidebar__new-chat {
    min-height: 36px;
    padding: 7px 8px;
  }

  .agent-sidebar-rail {
    max-height: calc(36dvh - 58px);
  }

  .agent-session-item,
  .agent-session-item__main {
    min-height: 36px;
  }

  .agent-home-content {
    padding: 10px;
  }

  .agent-home-panel__body h2 {
    font-size: 1.1rem;
  }
}
</style>

