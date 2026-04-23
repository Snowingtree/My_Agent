<template>
  <main class="agent-page">
    <AgentWorkspace
      :active-session-id="activeSessionId"
      :active-session-title="activeSession?.title || '新对话'"
      :ai-configs="aiConfigs"
      :can-send="canSend"
      :chat-error="chatError"
      :draft="draft"
      :is-creating-session="isCreatingSession"
      :is-loading-ai-configs="isLoadingAiConfigs"
      :is-loading-session="isLoadingSession"
      :is-loading-sessions="isLoadingSessions"
      :is-sending="isSending"
      :load-error="loadError"
      :messages="activeMessages"
      :model-options="modelOptions"
      :selected-agent-label="selectedAgentLabel"
      :selected-ai-id="selectedAiId"
      :selected-model="selectedModel"
      :selected-model-label="selectedModelLabel"
      :session-error="sessionError"
      :sessions="sessions"
      :task="currentTask"
      :username="username"
      @create-session="createSession"
      @delete-session="deleteSession"
      @logout="$emit('logout')"
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
  aiConfigs,
  canSend,
  chatError,
  createSession,
  currentTask,
  deleteSession,
  draft,
  isCreatingSession,
  isLoadingAiConfigs,
  isLoadingSession,
  isLoadingSessions,
  isSending,
  loadError,
  modelOptions,
  selectSession,
  selectedAgentLabel,
  selectedAiId,
  selectedModel,
  selectedModelLabel,
  sendMessage,
  sessionError,
  sessions,
  setSelectedAiId,
  setSelectedModel
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
  padding: 16px;
  background: #ffffff;
  overflow: hidden;
}

@media (max-width: 720px) {
  .agent-page {
    padding: 12px;
  }
}
</style>
