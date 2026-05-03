<template>
  <main class="agent-page">
    <aside class="agent-page__sidebar">
      <div class="agent-sidebar__top">
        <div class="agent-sidebar__brand">
          <span class="agent-user-card__avatar">{{ userInitial }}</span>
          <div>
            <strong>Agent</strong>
            <small>{{ username }}</small>
          </div>
        </div>

        <button
          type="button"
          class="agent-sidebar__icon-button"
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

      <div class="agent-sidebar-rail">
        <div class="agent-sidebar-rail__track" :class="{ 'is-settings-open': showModelConfig }">
          <section class="agent-sidebar-rail__panel">
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

          <section class="agent-sidebar-rail__panel">
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
                  :class="{ 'is-active': activeSettingsSection === 'settings-tools' }"
                  @click="selectSettingsSection('settings-tools')"
                >
                  工具
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </aside>

    <section class="agent-page__content" :class="{ 'is-settings-open': showModelConfig }">
      <section class="agent-page__stage agent-page__stage--workspace" :aria-hidden="showModelConfig ? 'true' : 'false'">
        <AgentWorkspace
          :ephemeral-attachments="activeEphemeralAttachments"
          :expired-attachment-notice="expiredAttachmentNotice"
          :active-session-id="activeSessionId"
          :active-session-title="activeSession?.title || '新对话'"
          :active-workspace-files="activeWorkspaceFiles"
          :active-workspace-folder="activeWorkspaceFolder"
          :ai-configs="aiConfigs"
          :can-send="canSend"
          :chat-error="chatError"
          :draft="draft"
          :hide-sidebar="true"
          :is-agent-running="isAgentRunning"
          :is-cancelling-task="isCancellingTask"
          :is-creating-session="isCreatingSession"
          :is-loading-ai-configs="isLoadingAiConfigs"
          :is-loading-skills="isLoadingSkills"
          :is-loading-session="isLoadingSession"
          :is-loading-sessions="isLoadingSessions"
          :is-loading-workspace-file="isLoadingWorkspaceFile"
          :is-refreshing-active-session="isRefreshingActiveSession"
          :is-sending="isSending"
          :load-error="loadError"
          :messages="activeMessages"
          :model-options="modelOptions"
          :selected-agent-label="selectedAgentLabel"
          :selected-ai-id="selectedAiId"
          :selected-model="selectedModel"
          :selected-model-label="selectedModelLabel"
          :selected-skill-ids="selectedSkillIds"
          :selected-skill-label="selectedSkillLabel"
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
          @refresh-session="refreshActiveSession"
          @send="sendMessage"
          @upload-attachments="addEphemeralAttachments"
          @update:ai-id="setSelectedAiId"
          @update:draft="draft = $event"
          @update:model="setSelectedModel"
          @update:skill-ids="setSelectedSkillIds"
        />
      </section>

      <section class="agent-page__stage agent-page__stage--settings" :aria-hidden="showModelConfig ? 'false' : 'true'">
        <section class="agent-settings-content">
          <ModelConfigPage :active-section="activeSettingsSection" @back="closeModelConfig" />
        </section>
      </section>
    </section>
  </main>
</template>

<script setup>
import { computed, ref } from 'vue'
import { createMessage } from 'snowingress-my-components'
import { getAgentUsername } from '../auth.js'
import { useAgentWorkspace } from '../useAgentWorkspace.js'
import AgentWorkspace from './agent/AgentWorkspace/AgentWorkspace.vue'
import ModelConfigPage from './agent/ModelConfigPage.vue'

defineEmits(['logout'])

const showModelConfig = ref(false)
const activeSettingsSection = ref('settings-ai')

function notify({ message, type = 'success' }) {
  createMessage({
    message,
    type,
    duration: 1600,
    offset: 24
  })
}

function openModelConfig() {
  showModelConfig.value = true
  activeSettingsSection.value = activeSettingsSection.value || 'settings-ai'
}

function closeModelConfig() {
  showModelConfig.value = false
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
  showModelConfig.value = true
}

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
  activeWorkspaceFiles,
  activeWorkspaceFolder,
  addEphemeralAttachments,
  aiConfigs,
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
  isLoadingSkills,
  isLoadingSession,
  isLoadingSessions,
  isLoadingWorkspaceFile,
  isRefreshingActiveSession,
  isSending,
  loadError,
  modelOptions,
  openWorkspaceFile,
  refreshActiveSession,
  removeEphemeralAttachment,
  selectSession,
  selectedAgentLabel,
  selectedAiId,
  selectedModel,
  selectedModelLabel,
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

.agent-sidebar__icon-button:hover,
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
  grid-template-columns: 1fr 1fr;
  width: 200%;
  height: 100%;
  transform: translateX(0);
  transition: transform 760ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.agent-sidebar-rail__track.is-settings-open {
  transform: translateX(-50%);
}

.agent-sidebar-rail__panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 8px;
  padding-right: 10px;
}

.agent-sidebar-rail__panel:last-child {
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 0;
  align-items: center;
  min-height: 40px;
  border-radius: 10px;
  background: transparent;
}

.agent-session-item.is-active {
  background: #e7e7e7;
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
}

.agent-settings-nav__item.is-active {
  background: #e7e7e7;
  color: #202020;
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

.agent-page__content.is-settings-open .agent-page__stage--workspace {
  opacity: 0;
  pointer-events: none;
}

.agent-page__content.is-settings-open .agent-page__stage--settings {
  z-index: 3;
  opacity: 1;
  pointer-events: auto;
}

.agent-settings-content {
  height: 100%;
  overflow: hidden;
  background: #f6f8fb;
  display: flex;
  flex-direction: column;
}

@media (max-width: 1180px) {
  .agent-page {
    grid-template-columns: 280px minmax(0, 1fr);
  }
}

@media (max-width: 920px) {
  .agent-page {
    grid-template-columns: 1fr;
  }

  .agent-page__sidebar {
    border-right: 0;
    border-bottom: 1px solid #ececec;
  }

  .agent-sidebar-rail__track {
    grid-template-columns: 1fr;
    width: 100%;
    transform: none;
  }

  .agent-sidebar-rail__track.is-settings-open {
    transform: none;
  }

  .agent-sidebar-rail__panel {
    padding: 0;
  }

  .agent-sidebar-rail__panel:last-child {
    display: none;
  }
}
</style>
