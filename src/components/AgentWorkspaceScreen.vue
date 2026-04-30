<template>
  <main class="agent-page">
    <AgentWorkspace
      :active-session-id="activeSessionId"
      :active-session-title="activeSession?.title || '新对话'"
      :ai-configs="aiConfigs"
      :active-workspace-files="activeWorkspaceFiles"
      :active-workspace-folder="activeWorkspaceFolder"
      :can-send="canSend"
      :chat-error="chatError"
      :draft="draft"
      :is-loading-workspace-file="isLoadingWorkspaceFile"
      :is-creating-session="isCreatingSession"
      :is-cancelling-task="isCancellingTask"
      :is-agent-running="isAgentRunning"
      :is-loading-ai-configs="isLoadingAiConfigs"
      :is-loading-session="isLoadingSession"
      :is-loading-sessions="isLoadingSessions"
      :is-refreshing-active-session="isRefreshingActiveSession"
      :is-sending="isSending"
      :load-error="loadError"
      :messages="activeMessages"
      :model-options="modelOptions"
      :selected-agent-label="selectedAgentLabel"
      :selected-ai-id="selectedAiId"
      :selected-model="selectedModel"
      :selected-model-label="selectedModelLabel"
      :selected-workspace-file-content="selectedWorkspaceFileContent"
      :selected-workspace-file-path="selectedWorkspaceFilePath"
      :selected-workspace-file-size-bytes="selectedWorkspaceFileSizeBytes"
      :selected-workspace-file-updated-at="selectedWorkspaceFileUpdatedAt"
      :session-error="sessionError"
      :sessions="sessions"
      :task="currentTask"
      :username="username"
      :workspace-mode="workspaceMode"
      :workspace-file-error="workspaceFileError"
      @create-session="createSession"
      @cancel-task="cancelActiveTask"
      @close-model-config="closeModelConfig"
      @close-workspace-file="closeWorkspaceFile"
      @delete-session="deleteSession"
      @logout="$emit('logout')"
      @open-model-config="openModelConfig"
      @open-workspace-file="openWorkspaceFile"
      @refresh-session="refreshActiveSession"
      @select-session="selectSession"
      @send="sendMessage"
      @update:ai-id="setSelectedAiId"
      @update:draft="draft = $event"
      @update:model="setSelectedModel"
    />

    <!-- Model Config Modal -->
    <div v-if="showModelConfig" class="agent-modal-backdrop" @click="closeModelConfig">
      <div class="agent-modal agent-modal--large" @click.stop>
        <div class="agent-modal__head">
          <h2 class="agent-modal__title">模型配置</h2>
          <button class="agent-modal__close" @click="closeModelConfig">
            ×
          </button>
        </div>
        <div class="agent-modal__body">
          <ModelConfigPage @back="closeModelConfig" />
        </div>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { createMessage } from 'snowingress-my-components'
import AgentWorkspace from './agent/AgentWorkspace/AgentWorkspace.vue'
import ModelConfigPage from './agent/ModelConfigPage.vue'
import { getAgentUsername } from '../auth.js'
import { useAgentWorkspace } from '../useAgentWorkspace.js'

const emit = defineEmits(['logout', 'open-model-config'])

const showModelConfig = ref(false)

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
  emit('open-model-config')
}

function closeModelConfig() {
  showModelConfig.value = false
}

const username = ref(getAgentUsername({ storage: localStorage }))
const {
  activeMessages,
  activeSession,
  activeSessionId,
  activeWorkspaceFiles,
  activeWorkspaceFolder,
  aiConfigs,
  cancelActiveTask,
  canSend,
  chatError,
  closeWorkspaceFile,
  createSession,
  currentTask,
  deleteSession,
  draft,
  isCancellingTask,
  isAgentRunning,
  isCreatingSession,
  isLoadingAiConfigs,
  isLoadingSession,
  isLoadingSessions,
  isLoadingWorkspaceFile,
  isRefreshingActiveSession,
  isSending,
  loadError,
  modelOptions,
  openWorkspaceFile,
  refreshActiveSession,
  selectSession,
  selectedAgentLabel,
  selectedAiId,
  selectedModel,
  selectedModelLabel,
  selectedWorkspaceFileContent,
  selectedWorkspaceFilePath,
  selectedWorkspaceFileSizeBytes,
  selectedWorkspaceFileUpdatedAt,
  sendMessage,
  sessionError,
  sessions,
  setSelectedAiId,
  setSelectedModel,
  workspaceMode,
  workspaceFileError
} = useAgentWorkspace({
  storage: localStorage,
  notify,
  confirmDelete: () => window.confirm('确认删除这个 Agent 会话吗？')
})
</script>

<style scoped>
.agent-page {
  height: 100dvh;
  min-height: 100dvh;
  padding: 0;
  background: #ffffff;
  overflow: hidden;
}

@media (max-width: 720px) {
  .agent-page {
    padding: 0;
  }
}
</style>

<style>
.agent-modal-backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.agent-modal {
  position: relative;
  width: 100%;
  max-width: 900px;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.agent-modal--large {
  max-width: 1000px;
}

.agent-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 28px 20px;
  border-bottom: 1px solid #ececec;
}

.agent-modal__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #171717;
}

.agent-modal__close {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 12px;
  background: #f0f0f0;
  color: #444444;
  cursor: pointer;
  font-size: 1.5rem;
  line-height: 1;
  transition: all 0.18s ease;
}

.agent-modal__close:hover {
  background: #e4e4e4;
}

.agent-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
</style>
