<template>
  <div class="agent-shell">
    <aside class="agent-shell__sidebar">
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
          :disabled="isCreatingSession"
          aria-label="新建对话"
          @click="$emit('create-session')"
        >
          +
        </button>
      </div>

      <button
        type="button"
        class="agent-sidebar__new-chat"
        :disabled="isCreatingSession"
        @click="$emit('create-session')"
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
                  @click="$emit('select-session', item.sessionId)"
                >
                  <span class="agent-session-item__title">{{ item.title }}</span>
                </button>

                <button
                  type="button"
                  class="agent-session-item__delete"
                  aria-label="删除会话"
                  @click="$emit('delete-session', item.sessionId)"
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
    </aside>

    <section class="agent-shell__main">
      <header class="agent-mainbar">
        <div class="agent-mainbar__copy">
          <div class="agent-mainbar__status">
            <span class="agent-mainbar__status-dot"></span>
            <span>Agent Workspace</span>
          </div>
          <h2>{{ activeSessionTitle }}</h2>
        </div>
      </header>

      <section class="agent-conversation">
        <p v-if="chatError || loadError" class="form-error agent-conversation__status">
          {{ chatError || loadError }}
        </p>
        <p v-else-if="isLoadingSession" class="agent-conversation__status">正在读取会话内容...</p>

        <div ref="messagesRef" class="agent-conversation__messages">
          <div v-if="!messages.length && !isLoadingSession" class="agent-conversation__welcome">
            <div class="agent-conversation__welcome-copy">
              <p class="agent-conversation__welcome-tag">Agent Workspace</p>
              <h3>把目标交给 Agent，持续推进到结果</h3>
              <p>
                直接输入任务、问题或待办，我会围绕同一个目标持续拆解、追问、整理和补全。
              </p>
            </div>

            <div class="agent-conversation__starter-grid">
              <button
                type="button"
                class="agent-starter-card"
                @click="$emit('update:draft', '帮我把这个目标拆成一个可执行的计划，并给出优先级。')"
              >
                <strong>拆成计划</strong>
                <span>把一个模糊目标拆成清晰步骤和优先级。</span>
              </button>
              <button
                type="button"
                class="agent-starter-card"
                @click="$emit('update:draft', '基于这个目标，先帮我整理当前问题结构，再给出推进策略。')"
              >
                <strong>整理结构</strong>
                <span>先理清问题，再组织一条可持续推进的路线。</span>
              </button>
              <button
                type="button"
                class="agent-starter-card"
                @click="$emit('update:draft', '继续往下追问，把还没考虑到的风险和细节也补出来。')"
              >
                <strong>继续深化</strong>
                <span>自动追问缺口，把风险、细节和下一步补齐。</span>
              </button>
            </div>
          </div>

          <article
            v-for="item in messages"
            :key="item.messageId"
            :class="[
              'agent-message',
              item.role === 'user' ? 'agent-message--user' : 'agent-message--assistant'
            ]"
          >
            <span class="agent-message__role">{{ item.role === 'user' ? '你' : 'Agent' }}</span>
            <div class="agent-message__bubble">
              <p>{{ item.content }}</p>
            </div>
          </article>

          <div v-if="isSending" class="agent-conversation__sending">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>

        <div class="agent-composer" :class="{ 'is-home': !messages.length }">
          <textarea
            ref="composerRef"
            :value="draft"
            class="agent-composer__input"
            :disabled="isSending"
            @input="$emit('update:draft', $event.target.value)"
            @keydown="handleComposerKeydown"
          />

          <div class="agent-composer__actions">
            <button
              type="button"
              class="agent-composer__send"
              :disabled="!canSend"
              @click="requestSend"
            >
              {{ isSending ? '发送中...' : '发送' }}
            </button>
          </div>
        </div>
      </section>
    </section>

    <aside class="agent-shell__inspector">
      <section class="agent-inspector__card">
        <div class="agent-inspector__head">
          <p class="agent-inspector__eyebrow">Model</p>
          <h3>运行配置</h3>
        </div>

        <label class="agent-inspector__field">
          <span>Agent 配置</span>
          <select
            :value="selectedAiId"
            class="agent-inspector__select"
            :disabled="isLoadingAiConfigs || isSending || !aiConfigs.length"
            @change="$emit('update:ai-id', $event.target.value)"
          >
            <option value="">{{ isLoadingAiConfigs ? '读取中...' : '请选择 Agent 配置' }}</option>
            <option v-for="item in aiConfigs" :key="item.aiId" :value="item.aiId">
              {{ item.label }}
            </option>
          </select>
        </label>

        <label class="agent-inspector__field">
          <span>模型版本</span>
          <select
            :value="selectedModel"
            class="agent-inspector__select"
            :disabled="isSending || !modelOptions.length"
            @change="$emit('update:model', $event.target.value)"
          >
            <option value="">{{ modelOptions.length ? '请选择模型版本' : '当前配置没有可用模型' }}</option>
            <option v-for="item in modelOptions" :key="item" :value="item">
              {{ item }}
            </option>
          </select>
        </label>

        <p v-if="loadError" class="agent-inspector__warning">
          {{ loadError }}
        </p>
        <p v-else-if="!isLoadingAiConfigs && !aiConfigs.length" class="agent-inspector__warning">
          当前没有可用的 Agent 配置，请先补充 AI 配置。
        </p>

        <div class="agent-inspector__selected">
          <span class="agent-inspector__selected-label">当前选择</span>
          <strong>{{ selectedAgentLabel || '未选择配置' }}</strong>
          <p>{{ selectedModelLabel || '未选择模型' }}</p>
        </div>
      </section>

      <section class="agent-inspector__card">
        <div class="agent-inspector__head">
          <p class="agent-inspector__eyebrow">Status</p>
          <h3>工作台状态</h3>
        </div>

        <div class="agent-status-grid">
          <article class="agent-status-card">
            <span>会话数</span>
            <strong>{{ sessions.length }}</strong>
          </article>
          <article class="agent-status-card">
            <span>消息数</span>
            <strong>{{ messages.length }}</strong>
          </article>
        </div>
      </section>
    </aside>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  activeSessionId: {
    type: String,
    default: ''
  },
  activeSessionTitle: {
    type: String,
    default: '当前会话'
  },
  aiConfigs: {
    type: Array,
    default: () => []
  },
  canSend: {
    type: Boolean,
    default: false
  },
  chatError: {
    type: String,
    default: ''
  },
  draft: {
    type: String,
    default: ''
  },
  isCreatingSession: {
    type: Boolean,
    default: false
  },
  isLoadingAiConfigs: {
    type: Boolean,
    default: false
  },
  isLoadingSession: {
    type: Boolean,
    default: false
  },
  isLoadingSessions: {
    type: Boolean,
    default: false
  },
  isSending: {
    type: Boolean,
    default: false
  },
  loadError: {
    type: String,
    default: ''
  },
  messages: {
    type: Array,
    default: () => []
  },
  modelOptions: {
    type: Array,
    default: () => []
  },
  selectedAgentLabel: {
    type: String,
    default: ''
  },
  selectedAiId: {
    type: String,
    default: ''
  },
  selectedModel: {
    type: String,
    default: ''
  },
  selectedModelLabel: {
    type: String,
    default: ''
  },
  sessionError: {
    type: String,
    default: ''
  },
  sessions: {
    type: Array,
    default: () => []
  },
  task: {
    type: Object,
    default: null
  },
  username: {
    type: String,
    default: '访客'
  }
})

const emit = defineEmits([
  'create-session',
  'delete-session',
  'logout',
  'select-session',
  'send',
  'update:ai-id',
  'update:draft',
  'update:model'
])

const composerRef = ref(null)
const messagesRef = ref(null)
const shouldRestoreFocus = ref(false)

const userInitial = computed(() => {
  const normalized = String(props.username || '').trim()
  return normalized ? normalized.slice(0, 1).toUpperCase() : 'A'
})

function scrollMessagesToBottom(behavior = 'auto') {
  nextTick(() => {
    const container = messagesRef.value

    if (!container) {
      return
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior
    })
  })
}

function focusComposer() {
  nextTick(() => {
    composerRef.value?.focus()
  })
}

function requestSend() {
  if (!props.canSend || props.isSending) {
    return
  }

  shouldRestoreFocus.value = true
  emit('send')
}

function handleComposerKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return
  }

  event.preventDefault()
  requestSend()
}

watch(
  () => props.isSending,
  (isSending, wasSending) => {
    if (isSending) {
      scrollMessagesToBottom()
    }

    if (wasSending && !isSending && shouldRestoreFocus.value) {
      scrollMessagesToBottom()
      focusComposer()
      shouldRestoreFocus.value = false
    }
  }
)

watch(
  () => props.messages.length,
  (nextLength, previousLength) => {
    if (nextLength !== previousLength) {
      scrollMessagesToBottom()
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.agent-shell {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 292px;
  gap: 14px;
  height: 100%;
  min-height: 0;
}

.agent-shell__sidebar,
.agent-shell__main,
.agent-shell__inspector {
  min-height: 0;
  border: 1px solid rgba(18, 52, 78, 0.08);
  background: #ffffff;
  box-shadow:
    0 18px 40px rgba(24, 67, 115, 0.08),
    0 3px 10px rgba(24, 67, 115, 0.04);
}

.agent-shell__sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border-radius: 26px;
  overflow: hidden;
}

.agent-user-card strong {
  display: block;
  color: #12344e;
}

.agent-sidebar__launch {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgba(47, 125, 255, 0.1), transparent 32%),
    linear-gradient(180deg, rgba(250, 252, 255, 0.98), rgba(245, 249, 255, 0.95));
  border: 1px solid rgba(18, 52, 78, 0.07);
}

.agent-sidebar__primary,
.agent-sidebar__logout {
  min-height: 44px;
  border-radius: 14px;
  cursor: pointer;
  font: inherit;
  transition: transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.agent-sidebar__primary {
  border: 0;
  color: #f6fbff;
  background: linear-gradient(135deg, #2f7dff 0%, #4bb6ff 100%);
  box-shadow: 0 14px 26px rgba(47, 125, 255, 0.22);
}

.agent-sidebar__logout {
  border: 1px solid rgba(18, 52, 78, 0.08);
  color: #35556f;
  background: rgba(245, 249, 255, 0.96);
}

.agent-sidebar__primary:hover,
.agent-sidebar__logout:hover {
  transform: translateY(-1px);
}

.agent-sidebar__primary:disabled {
  opacity: 0.62;
  transform: none;
}

.agent-sidebar__section {
  display: grid;
  gap: 10px;
}

.agent-sidebar__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #6f89a2;
  font-size: 0.76rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.agent-sidebar__footer {
  display: grid;
  gap: 12px;
  margin-top: auto;
}

.agent-user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(248, 252, 255, 0.98), rgba(242, 248, 255, 0.94));
  border: 1px solid rgba(18, 52, 78, 0.07);
}

.agent-user-card--sidebar {
  padding: 12px 14px;
}

.agent-user-card__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: rgba(47, 125, 255, 0.12);
  color: #2565ca;
  font-weight: 700;
}

.agent-session-list {
  display: grid;
  gap: 12px;
  min-height: 0;
}

.agent-session-list__body {
  display: grid;
  align-content: start;
  min-height: 220px;
  height: clamp(220px, 34vh, 360px);
  padding: 10px 8px 10px 0;
  border-top: 1px solid rgba(18, 52, 78, 0.08);
}

.agent-session-list__status {
  margin: 0;
  padding-right: 8px;
  color: #6c879f;
  line-height: 1.65;
}

.agent-session-list__status--empty {
  padding: 14px;
  border-radius: 18px;
  background: rgba(246, 250, 255, 0.96);
  border: 1px dashed rgba(18, 52, 78, 0.12);
}

.agent-session-list__items {
  display: grid;
  gap: 8px;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding-right: 6px;
  scrollbar-width: thin;
}

.agent-session-list__items::-webkit-scrollbar {
  width: 6px;
}

.agent-session-list__items::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(18, 52, 78, 0.18);
}

.agent-session-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 46px;
  padding: 6px 8px 6px 10px;
  border-radius: 14px;
  border: 1px solid rgba(122, 190, 255, 0.55);
  background: linear-gradient(180deg, rgba(246, 251, 255, 0.98), rgba(239, 247, 255, 0.94));
  transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}

.agent-session-item:hover {
  border-color: rgba(74, 151, 255, 0.7);
  background: linear-gradient(180deg, rgba(244, 250, 255, 0.99), rgba(232, 244, 255, 0.96));
  box-shadow: 0 10px 18px rgba(68, 132, 214, 0.08);
}

.agent-session-item.is-active {
  color: #0f4ea6;
  border-color: rgba(74, 151, 255, 0.85);
  background: linear-gradient(180deg, rgba(240, 248, 255, 0.99), rgba(228, 241, 255, 0.97));
  box-shadow: 0 12px 20px rgba(47, 125, 255, 0.1);
}

.agent-session-item__main {
  display: flex;
  align-items: center;
  min-width: 0;
  border: 0;
  width: 100%;
  min-height: 32px;
  padding: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.agent-session-item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.agent-session-item__dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(18, 52, 78, 0.18);
}

.agent-session-item__title {
  min-width: 0;
  color: #12344e;
  font-weight: 500;
  line-height: 1.35;
  font-size: 0.94rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-session-item.is-active .agent-session-item__title {
  color: #0f4ea6;
  font-weight: 700;
}

.agent-session-item.is-active .agent-session-item__dot {
  background: rgba(47, 125, 255, 0.72);
}

.agent-session-item__delete {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.66);
  color: #7f98b2;
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease, background-color 160ms ease, color 160ms ease;
}

.agent-session-item:hover .agent-session-item__delete {
  opacity: 1;
  pointer-events: auto;
}

.agent-session-item__delete:hover {
  background: rgba(18, 52, 78, 0.08);
  color: #4c647c;
}

.agent-shell__main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  padding: 16px;
  border-radius: 30px;
  overflow: hidden;
}

.agent-mainbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 4px 10px;
  border-bottom: 1px solid rgba(18, 52, 78, 0.08);
}

.agent-mainbar__copy {
  min-width: 0;
}

.agent-mainbar__copy h2 {
  margin: 0;
  color: #12344e;
  font-size: 1.42rem;
  line-height: 1.15;
}

.agent-mainbar__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: #6f8ba5;
  font-size: 0.76rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.agent-mainbar__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1bc47d;
  box-shadow: 0 0 0 4px rgba(27, 196, 125, 0.12);
}

.agent-conversation {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
  border-radius: 22px;
  background:
    radial-gradient(circle at top right, rgba(47, 125, 255, 0.07), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(250, 252, 255, 0.98));
  border: 1px solid rgba(18, 52, 78, 0.07);
}

.agent-conversation__status {
  margin: 0;
  flex: 0 0 auto;
}

.agent-conversation__messages {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  padding-bottom: 220px;
}

.agent-conversation__welcome {
  display: grid;
  gap: 20px;
  align-content: center;
  min-height: min(54dvh, 520px);
  padding: 38px 34px;
  border-radius: 32px;
  background:
    radial-gradient(circle at top right, rgba(47, 125, 255, 0.14), transparent 30%),
    linear-gradient(180deg, rgba(252, 254, 255, 0.99), rgba(245, 250, 255, 0.97));
  border: 1px solid rgba(18, 52, 78, 0.08);
}

.agent-conversation__welcome-copy {
  display: grid;
  gap: 12px;
  justify-items: center;
  text-align: center;
}

.agent-conversation__welcome-tag {
  margin: 0;
  color: #4d7dff;
  font-size: 0.8rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.agent-conversation__welcome h3,
.agent-conversation__welcome p {
  margin: 0;
}

.agent-conversation__welcome h3 {
  max-width: 14ch;
  color: #12344e;
  font-size: clamp(2rem, 3.6vw, 3rem);
  line-height: 1.02;
}

.agent-conversation__welcome p {
  max-width: 38rem;
  color: #5f7c96;
  line-height: 1.72;
}

.agent-conversation__starter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.agent-starter-card {
  display: grid;
  gap: 8px;
  min-height: 132px;
  padding: 18px;
  border: 1px solid rgba(18, 52, 78, 0.08);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.96);
  color: #35556f;
  text-align: left;
  cursor: pointer;
  transition: transform 160ms ease, background-color 160ms ease, border-color 160ms ease;
}

.agent-starter-card strong,
.agent-starter-card span {
  display: block;
}

.agent-starter-card strong {
  color: #12344e;
  font-size: 1rem;
}

.agent-starter-card span {
  color: #65819b;
  line-height: 1.65;
  font-size: 0.86rem;
}

.agent-starter-card:hover {
  transform: translateY(-1px);
  border-color: rgba(47, 125, 255, 0.24);
  background: rgba(47, 125, 255, 0.06);
}

.agent-message {
  display: grid;
  gap: 8px;
  max-width: min(100%, 78%);
}

.agent-message--user {
  align-self: flex-end;
  justify-items: end;
}

.agent-message--assistant {
  align-self: flex-start;
}

.agent-message__role {
  color: #718ca8;
  font-size: 0.78rem;
  font-weight: 700;
}

.agent-message__bubble {
  padding: 14px 16px;
  border-radius: 20px;
  border: 1px solid rgba(18, 52, 78, 0.07);
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(24, 67, 115, 0.05);
}

.agent-message--assistant .agent-message__bubble {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(249, 252, 255, 0.97));
}

.agent-message--user .agent-message__bubble {
  background: linear-gradient(135deg, rgba(47, 125, 255, 0.14), rgba(76, 180, 255, 0.08));
}

.agent-message__bubble p {
  margin: 0;
  color: #23445c;
  line-height: 1.78;
  white-space: pre-wrap;
}

.agent-conversation__sending {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  width: fit-content;
  border-radius: 999px;
  background: rgba(244, 249, 255, 0.96);
}

.agent-conversation__sending span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #5b95ff;
  animation: agent-thinking 1.1s ease-in-out infinite;
}

.agent-conversation__sending span:nth-child(2) {
  animation-delay: 0.15s;
}

.agent-conversation__sending span:nth-child(3) {
  animation-delay: 0.3s;
}

.agent-composer {
  display: grid;
  gap: 14px;
  padding: 18px;
  min-height: 172px;
  border-radius: 26px;
  border: 1px solid rgba(18, 52, 78, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(248, 252, 255, 0.98));
  box-shadow: 0 16px 26px rgba(24, 67, 115, 0.05);
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 2;
  overflow: hidden;
}

.agent-composer__input {
  width: 100%;
  display: block;
  min-height: 120px;
  max-height: 120px;
  border: 0;
  padding: 0;
  background: transparent;
  color: #12344e;
  font: inherit;
  line-height: 1.72;
  resize: none;
  overflow-y: auto;
  outline: none;
}

.agent-composer__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.agent-composer__send {
  min-width: 120px;
  min-height: 46px;
  border: 0;
  border-radius: 16px;
  background: linear-gradient(135deg, #2f7dff 0%, #4bb6ff 100%);
  color: #f4f8ff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  box-shadow: 0 14px 26px rgba(47, 125, 255, 0.22);
}

.agent-composer__send:disabled {
  cursor: not-allowed;
  opacity: 0.56;
  box-shadow: none;
}

.agent-shell__inspector {
  display: grid;
  gap: 12px;
  align-content: start;
  padding: 16px;
  border-radius: 26px;
  overflow: auto;
}

.agent-inspector__card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgba(47, 125, 255, 0.08), transparent 30%),
    #ffffff;
  border: 1px solid rgba(18, 52, 78, 0.07);
}

.agent-inspector__head {
  display: grid;
  gap: 4px;
}

.agent-inspector__eyebrow {
  margin: 0;
  color: #6f8ba5;
  font-size: 0.76rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.agent-inspector__head h3 {
  margin: 0;
  color: #12344e;
}

.agent-inspector__field {
  display: grid;
  gap: 6px;
}

.agent-inspector__field > span {
  color: #6c879f;
  font-size: 0.9rem;
}

.agent-inspector__select {
  width: 100%;
  min-height: 42px;
  border: 1px solid rgba(18, 52, 78, 0.08);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(248, 252, 255, 0.96);
  color: #12344e;
  font: inherit;
  outline: none;
}

.agent-inspector__warning {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px dashed rgba(216, 126, 61, 0.28);
  background: rgba(255, 248, 240, 0.96);
  color: #995d24;
  line-height: 1.7;
}

.agent-inspector__selected {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(247, 250, 255, 0.98);
  border: 1px solid rgba(18, 52, 78, 0.06);
}

.agent-inspector__selected-label,
.agent-status-card span {
  color: #6f8ba5;
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-inspector__selected strong,
.agent-status-card strong {
  color: #12344e;
}

.agent-inspector__selected p {
  margin: 0;
  color: #5f7c96;
}

.agent-status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.agent-status-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(248, 252, 255, 0.98);
  border: 1px solid rgba(18, 52, 78, 0.05);
}

.agent-status-card strong {
  font-size: 1rem;
  line-height: 1.5;
}

.agent-shell {
  grid-template-columns: 280px minmax(0, 1fr) 292px;
  gap: 12px;
}

.agent-shell__sidebar {
  gap: 8px;
  padding: 10px;
  border: 0;
  border-radius: 22px;
  background: #f7f7f7;
  box-shadow: none;
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
  color: #111111;
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
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #111111;
  color: #ffffff;
  font-size: 0.8rem;
}

.agent-sidebar__icon-button,
.agent-sidebar__new-chat,
.agent-session-item__main,
.agent-session-item__delete,
.agent-sidebar__logout {
  border: 0;
  background: transparent;
}

.agent-sidebar__icon-button {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #303030;
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
  transition: background-color 150ms ease;
}

.agent-sidebar__icon-button:hover,
.agent-sidebar__new-chat:hover,
.agent-sidebar__logout:hover {
  background: #ececec;
}

.agent-sidebar__new-chat {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 10px;
  color: #202020;
  cursor: pointer;
  text-align: left;
  font-size: 0.94rem;
  transition: background-color 150ms ease;
}

.agent-sidebar__new-chat:disabled,
.agent-sidebar__icon-button:disabled {
  opacity: 0.52;
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
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 6px;
  padding-top: 6px;
}

.agent-sidebar__section-head {
  padding: 8px 10px 4px;
  color: #8a8a8a;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
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
  height: auto;
  min-height: 0;
  border-top: 0;
  padding: 0;
}

.agent-session-list__items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  height: 100%;
  padding-right: 0;
  overflow-y: auto;
}

.agent-session-list__items::-webkit-scrollbar {
  width: 8px;
}

.agent-session-list__items::-webkit-scrollbar-thumb {
  border: 2px solid #f7f7f7;
  border-radius: 999px;
  background: #d1d1d1;
}

.agent-session-list__status {
  margin: 0 4px;
  padding: 10px;
  color: #777777;
  font-size: 0.92rem;
}

.agent-session-list__status--empty {
  border: 0;
  border-radius: 12px;
  background: #ededed;
}

.agent-session-item {
  min-height: 40px;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  box-shadow: none;
  color: #1f1f1f;
}

.agent-session-item:hover {
  border-color: transparent;
  background: #eeeeee;
  box-shadow: none;
}

.agent-session-item.is-active {
  color: #111111;
  border-color: transparent;
  background: #e7e7e7;
  box-shadow: none;
}

.agent-session-item__main {
  min-height: 40px;
  padding: 0 10px 0 12px;
  border-radius: 10px;
}

.agent-session-item__title {
  color: inherit;
  font-size: 0.93rem;
  font-weight: 400;
  line-height: 1.35;
}

.agent-session-item.is-active .agent-session-item__title {
  color: #111111;
  font-weight: 500;
}

.agent-session-item__delete {
  width: 30px;
  height: 30px;
  align-self: center;
  justify-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #777777;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition: opacity 150ms ease, background-color 150ms ease, color 150ms ease;
}

.agent-session-item:hover .agent-session-item__delete,
.agent-session-item.is-active .agent-session-item__delete {
  opacity: 1;
  pointer-events: auto;
}

.agent-session-item__delete:hover {
  background: #dddddd;
  color: #111111;
}

.agent-sidebar__footer {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid #e8e8e8;
}

.agent-sidebar__logout {
  min-height: 40px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 10px;
  color: #4a4a4a;
  cursor: pointer;
  text-align: left;
  box-shadow: none;
  transition: background-color 150ms ease, color 150ms ease;
}

@keyframes agent-thinking {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }

  50% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

@media (max-width: 1320px) {
  .agent-shell {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .agent-shell__inspector {
    grid-column: 1 / -1;
  }
}

@media (max-width: 920px) {
  .agent-shell {
    grid-template-columns: 1fr;
    height: 100%;
    min-height: 0;
  }

  .agent-shell__sidebar,
  .agent-shell__main,
  .agent-shell__inspector {
    border-radius: 24px;
  }

  .agent-mainbar {
    display: grid;
  }

  .agent-conversation__starter-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .agent-conversation {
    padding: 14px;
  }

  .agent-message {
    max-width: 100%;
  }

  .agent-conversation__welcome {
    min-height: auto;
    padding: 24px 20px;
  }

  .agent-conversation__welcome-copy {
    justify-items: start;
    text-align: left;
  }

  .agent-composer__actions {
    display: flex;
    justify-content: flex-end;
  }

  .agent-composer__send {
    width: 100%;
  }

  .agent-conversation__messages {
    padding-bottom: 236px;
  }

  .agent-composer {
    left: 14px;
    right: 14px;
    bottom: 14px;
  }
}

.agent-shell {
  grid-template-columns: 292px minmax(0, 1fr) 300px;
  gap: 0;
  background: #ffffff;
}

.agent-shell__sidebar {
  border-radius: 0;
  background: #f7f7f8;
  border-right: 1px solid #ececec;
}

.agent-shell__main {
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: #ffffff;
  box-shadow: none;
}

.agent-mainbar {
  min-height: 60px;
  padding: 0 24px;
  border-bottom: 1px solid #eeeeee;
  background: rgba(255, 255, 255, 0.92);
}

.agent-mainbar__status {
  display: none;
}

.agent-mainbar__copy h2 {
  color: #171717;
  font-size: 1rem;
  font-weight: 600;
}

.agent-conversation {
  border: 0;
  border-radius: 0;
  background: #ffffff;
}

.agent-conversation__messages {
  width: min(100%, 780px);
  margin: 0 auto;
  padding: 28px 20px 190px;
}

.agent-conversation__welcome {
  min-height: min(56dvh, 520px);
  padding: 40px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.agent-conversation__welcome-tag {
  color: #8f8f8f;
}

.agent-conversation__welcome h3 {
  max-width: 16ch;
  color: #171717;
  font-size: clamp(2rem, 4vw, 2.7rem);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.agent-conversation__welcome p {
  color: #6b6b6b;
}

.agent-starter-card {
  border-color: #e8e8e8;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: none;
}

.agent-starter-card:hover {
  border-color: #d9d9d9;
  background: #f7f7f7;
}

.agent-starter-card strong {
  color: #171717;
}

.agent-starter-card span {
  color: #6f6f6f;
}

.agent-message {
  max-width: 100%;
  gap: 6px;
}

.agent-message--user {
  max-width: min(80%, 620px);
}

.agent-message--assistant {
  width: 100%;
}

.agent-message__role {
  color: #8a8a8a;
  font-size: 0.75rem;
}

.agent-message__bubble {
  border: 0;
  box-shadow: none;
}

.agent-message--assistant .agent-message__bubble {
  padding: 2px 0;
  background: transparent;
}

.agent-message--user .agent-message__bubble {
  padding: 12px 16px;
  border-radius: 22px;
  background: #f4f4f4;
}

.agent-message__bubble p {
  color: #171717;
  line-height: 1.75;
}

.agent-conversation__sending {
  background: #f4f4f4;
}

.agent-conversation__sending span {
  background: #8a8a8a;
}

.agent-composer {
  width: min(calc(100% - 40px), 780px);
  min-height: 112px;
  left: 50%;
  right: auto;
  bottom: 24px;
  transform: translateX(-50%);
  padding: 14px 14px 12px;
  border: 1px solid #dedede;
  border-radius: 28px;
  background: #ffffff;
  box-shadow:
    0 12px 34px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
}

.agent-composer__input {
  min-height: 62px;
  max-height: 180px;
  padding: 2px 4px;
  color: #171717;
}

.agent-composer__send {
  min-width: 82px;
  min-height: 38px;
  border-radius: 999px;
  background: #171717;
  color: #ffffff;
  box-shadow: none;
}

.agent-shell__inspector {
  border: 0;
  border-left: 1px solid #eeeeee;
  border-radius: 0;
  background: #ffffff;
  box-shadow: none;
}

.agent-inspector__card {
  border: 1px solid #eeeeee;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: none;
}

.agent-inspector__eyebrow,
.agent-inspector__field > span,
.agent-inspector__selected-label,
.agent-status-card span {
  color: #8a8a8a;
}

.agent-inspector__head h3,
.agent-inspector__selected strong,
.agent-status-card strong {
  color: #171717;
}

.agent-inspector__select,
.agent-inspector__selected,
.agent-status-card {
  border-color: #e8e8e8;
  background: #f9f9f9;
}

@media (max-width: 1320px) {
  .agent-shell {
    grid-template-columns: 292px minmax(0, 1fr);
  }
}

@media (max-width: 920px) {
  .agent-shell {
    grid-template-columns: 1fr;
  }

  .agent-shell__sidebar {
    border-right: 0;
    border-bottom: 1px solid #ececec;
  }

  .agent-shell__inspector {
    border-left: 0;
    border-top: 1px solid #eeeeee;
  }
}

@media (max-width: 720px) {
  .agent-mainbar {
    min-height: 56px;
    padding: 0 16px;
  }

  .agent-conversation__messages {
    padding: 22px 14px 186px;
  }

  .agent-composer {
    width: calc(100% - 24px);
    bottom: 12px;
  }
}
</style>
