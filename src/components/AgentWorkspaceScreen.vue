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
      @close-workspace-file="closeWorkspaceFile"
      @delete-session="deleteSession"
      @logout="$emit('logout')"
      @open-workspace-file="openWorkspaceFile"
      @refresh-session="refreshActiveSession"
      @select-session="selectSession"
      @send="sendMessage"
      @update:ai-id="setSelectedAiId"
      @update:draft="draft = $event"
      @update:model="setSelectedModel"
    />
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { createMessage } from 'snowingress-my-components'
import AgentWorkspace from './agent/AgentWorkspace/AgentWorkspace.vue'
import { getAgentUsername } from '../auth.js'
import { useAgentWorkspace } from '../useAgentWorkspace.js'

defineEmits(['logout'])

function notify({ message, type = 'success' }) {
  createMessage({
    message,
    type,
    duration: 1600,
    offset: 24
  })
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
