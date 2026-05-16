<template>
  <div
    ref="shellRef"
    class="agent-shell"
    :class="{
      'has-file-preview': hasWorkspaceFilePreview,
      'is-resizing-preview': isResizingPreview,
      'is-inspector-collapsed': isInspectorCollapsed,
      'is-sidebar-hidden': hideSidebar
    }"
    :style="shellStyle"
  >
    <aside v-if="!hideSidebar" class="agent-shell__sidebar">
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
          aria-label="打开模型配置"
          title="模型配置"
          @click="$emit('open-model-config')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
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

      <button
        type="button"
        class="agent-sidebar__new-chat"
        :disabled="isCreatingSession"
        @click="$emit('create-session')"
      >
        <span class="agent-sidebar__new-chat-icon">+</span>
        <span>{{ isCreatingSession ? '创建中...' : '新建对话' }}</span>
      </button>

      <div class="agent-sidebar__lower">
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
                    title="删除会话"
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
      </div>
    </aside>

    <section class="agent-shell__main">
      <Transition name="agent-copy-toast">
        <div v-if="conversationCopyToast" class="agent-copy-toast" role="status" aria-live="polite">
          复制成功
        </div>
      </Transition>

      <header class="agent-mainbar">
        <div class="agent-mainbar__copy">
          <div class="agent-mainbar__status">
            <span class="agent-mainbar__status-dot"></span>
            <span>Agent 工作台</span>
          </div>
          <h2>{{ activeSessionTitle }}</h2>
        </div>
        <div class="agent-mainbar__actions">
          <span class="agent-context-badge" :aria-label="contextUsageAriaLabel">
            {{ formattedContextUsage }}
          </span>
          <span v-if="totalTokens > 0" class="agent-token-badge">
            {{ formattedTotalTokens }}
          </span>
          <span class="agent-mode-badge" :class="`is-${resolvedWorkspaceMode.tone}`">
            {{ resolvedWorkspaceMode.label }}
          </span>
          <span class="agent-task-badge" :class="`is-${taskStatusTone}`">
            {{ taskStatusLabel }}
          </span>
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
              <p class="agent-conversation__welcome-tag">Agent 工作台</p>
              <h3>把目标交给 Agent，持续推进到结果</h3>
              <p>直接输入任务、问题或待办。启动后，Agent 会围绕同一个目标持续拆解、执行，并回写当前进展。</p>
              <p class="agent-conversation__auto-refresh-hint" style="margin-top: 12px; font-size: 0.86rem; color: #666;">
                💡 提示：当 Agent 成功修改文件后，会自动重新加载并显示最新内容
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
                <span>自动补齐风险、细节和下一步。</span>
              </button>
            </div>
          </div>

          <article
            v-for="item in messages"
            :key="item.messageId"
            :class="[
              'agent-message',
              `agent-message--${resolveMessageVariant(item)}`,
              {
                'is-progress': isProgressMessage(item),
                'is-partial': isPartialAssistantMessage(item)
              }
            ]"
          >
            <span class="agent-message__role">
              {{ isProgressMessage(item) ? '进行中' : resolveMessageLabelForDisplay(item.role) }}
            </span>
            <div class="agent-message__bubble">
              <template v-if="isProgressMessage(item)">
                <div class="agent-progress-card">
                  <span class="agent-progress-card__dot" aria-hidden="true"></span>
                  <div class="agent-progress-card__copy">
                    <strong>助手正在处理</strong>
                    <p>{{ formatMessageContentForDisplay(item.content, item.role) }}</p>
                  </div>
                </div>
              </template>
              <template v-else-if="resolveMessageVariant(item) === 'tool'">
                <div
                  class="agent-tool-card"
                  :class="[
                    `is-${resolveToolVisual(parseToolMessage(item.content)).tone}`,
                    `is-status-${parseToolMessage(item.content).status || 'success'}`,
                    { 'is-expanded': isToolMessageExpanded(item.messageId) }
                  ]"
                >
                  <div class="agent-tool-card__rail" aria-hidden="true">
                    <span class="agent-tool-card__dot"></span>
                    <span class="agent-tool-card__line"></span>
                  </div>
                  <div class="agent-tool-card__copy">
                    <div class="agent-tool-card__head">
                      <strong>{{ parseToolMessage(item.content).kind === 'skill' ? '技能调用' : '工具调用' }}</strong>
                      <span class="agent-tool-card__icon" aria-hidden="true">{{ resolveToolVisual(parseToolMessage(item.content)).icon }}</span>
                      <span class="agent-tool-card__name">{{ parseToolMessage(item.content).tool || 'unknown_tool' }}</span>
                      <span
                        class="agent-tool-card__status"
                        :class="{
                          'is-failed': parseToolMessage(item.content).status === 'failed',
                          'is-running': parseToolMessage(item.content).status === 'running'
                        }"
                      >
                        {{ resolveToolStatusLabel(parseToolMessage(item.content).status) }}
                      </span>
                      <button
                        type="button"
                        class="agent-tool-card__toggle"
                        :aria-expanded="isToolMessageExpanded(item.messageId) ? 'true' : 'false'"
                        @click="toggleToolMessage(item.messageId)"
                      >
                        <span>{{ isToolMessageExpanded(item.messageId) ? '收起' : '展开' }}</span>
                        <span
                          class="agent-tool-card__toggle-icon"
                          :class="{ 'is-expanded': isToolMessageExpanded(item.messageId) }"
                          aria-hidden="true"
                        >
                          ▾
                        </span>
                      </button>
                    </div>
                    <div class="agent-tool-card__meta-row">
                      <p v-if="parseToolMessage(item.content).target" class="agent-tool-card__meta">
                        {{ parseToolMessage(item.content).target }}
                      </p>
                      <p v-if="parseToolMessage(item.content).duration" class="agent-tool-card__meta agent-tool-card__meta--duration">
                        耗时 {{ parseToolMessage(item.content).duration }}
                      </p>
                    </div>
                    <div v-if="isToolMessageExpanded(item.messageId)" class="agent-tool-card__body">
                      <p class="agent-tool-card__result">{{ parseToolMessage(item.content).result }}</p>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="isLarkChatListMessage(item)">
                <div class="agent-lark-chat-list">
                  <table
                    v-if="parseLarkChatListMessage(item.content).items.length"
                    class="agent-lark-chat-table"
                  >
                    <thead>
                      <tr>
                        <th>群聊名称</th>
                        <th>群聊 ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="chat in parseLarkChatListMessage(item.content).items"
                        :key="chat.chatId"
                        class="agent-lark-chat-table__row"
                        :class="{ 'is-selected': chat.chatId === selectedLarkChatId }"
                        tabindex="0"
                        @click="selectLarkChatFromMessage(chat)"
                        @keydown.enter.prevent="selectLarkChatFromMessage(chat)"
                        @keydown.space.prevent="selectLarkChatFromMessage(chat)"
                      >
                        <td class="agent-lark-chat-table__name">{{ chat.name }}</td>
                        <td class="agent-lark-chat-table__id">{{ chat.chatId }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-else class="agent-lark-chat-list__empty">
                    没有读取到机器人可见的群聊。请确认机器人已加入目标群，并且飞书应用已开通群聊相关权限。
                  </p>
                </div>
              </template>
              <div
                v-else-if="shouldRenderMarkdownMessage(item)"
                class="agent-markdown-content"
                v-html="renderMessageMarkdown(item.content, item.role)"
              ></div>
              <p v-else>{{ formatMessageContentForDisplay(item.content, item.role) }}</p>
            </div>
            <div v-if="isCopyableConversationMessage(item)" class="agent-message__actions">
              <button
                type="button"
                class="agent-message__copy"
                :disabled="copyingMessageId === item.messageId"
                aria-label="复制消息"
                title="复制"
                @click="copyConversationMessage(item)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
                  <path d="M5 15V7a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8" />
                </svg>
              </button>
            </div>
          </article>

          <div v-if="isSending" class="agent-conversation__sending">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>

        <div class="agent-composer">
          <input
            ref="attachmentInputRef"
            class="agent-composer__attachment-input"
            type="file"
            multiple
            @change="handleAttachmentInputChange"
          />
          <textarea
            ref="composerRef"
            :value="draft"
            class="agent-composer__input"
            :disabled="isSending || isLoadingSession"
            :placeholder="resolvedComposerPlaceholder"
            @input="$emit('update:draft', $event.target.value)"
            @keydown="handleComposerKeydown"
          />

          <div v-if="ephemeralAttachments.length" class="agent-composer__attachments">
            <article
              v-for="item in ephemeralAttachments"
              :key="item.attachmentId"
              class="agent-composer__attachment-chip"
            >
              <div class="agent-composer__attachment-copy">
                <strong>{{ item.name }}</strong>
                <small>{{ formatEphemeralAttachmentMeta(item) }}</small>
              </div>
              <button
                type="button"
                class="agent-composer__attachment-remove"
                aria-label="移除临时文件"
                @click="$emit('remove-ephemeral-attachment', item.attachmentId)"
              >
                ×
              </button>
            </article>
          </div>

          <div class="agent-composer__actions">
            <button
              type="button"
              class="agent-composer__upload"
              :disabled="isSending || isLoadingSession"
              @click="openAttachmentPicker"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M8.5 12.5L14.8 6.2C16.4 4.6 19 4.6 20.6 6.2C22.2 7.8 22.2 10.4 20.6 12L11.7 20.9C9.5 23.1 6 23.1 3.8 20.9C1.6 18.7 1.6 15.2 3.8 13L13.2 3.6"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                />
              </svg>
            </button>
            <button
              v-if="isAgentRunning"
              type="button"
              class="agent-composer__stop"
              :disabled="isCancellingTask"
              @click="$emit('cancel-task')"
            >
              {{ isCancellingTask ? '正在停止...' : '停止处理' }}
            </button>
            <button
              type="button"
              class="agent-composer__send"
              :disabled="!canSend"
              @click="requestSend"
            >
              {{ resolvedSendButtonLabel }}
            </button>
          </div>
        </div>
      </section>

      <Transition name="skill-picker-fade">
        <div
          v-if="isSkillPickerOpen"
          class="agent-skill-picker"
          role="dialog"
          aria-modal="true"
          aria-label="配置会话附加信息"
          @click.self="closeSkillPicker"
        >
          <section class="agent-skill-picker__panel">
            <div class="agent-skill-picker__head">
              <div>
                <p class="agent-panel__eyebrow">会话附加信息</p>
                <h3>配置本轮会话上下文</h3>
              </div>
              <button
                type="button"
                class="agent-skill-picker__close"
                aria-label="关闭会话附加信息"
                @click="closeSkillPicker"
              >
                ×
              </button>
            </div>

            <div class="agent-session-extra">
              <nav class="agent-session-extra__nav" aria-label="会话附加信息类型">
                <button
                  v-for="item in sessionExtraTabs"
                  :key="item.id"
                  type="button"
                  class="agent-session-extra__nav-item"
                  :class="{ 'is-active': activeSessionExtraTab === item.id }"
                  @click="activeSessionExtraTab = item.id"
                >
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.summary }}</span>
                </button>
              </nav>

              <section class="agent-session-extra__content">
                <div v-if="activeSessionExtraTab === 'skill'" class="agent-session-extra__section">
                  <div class="agent-session-extra__section-head">
                    <div>
                      <p>Skill</p>
                      <small>{{ selectedSkillLabel }}</small>
                    </div>
                    <span>{{ selectedSkillIds.length ? `${selectedSkillIds.length} 个` : '自动' }}</span>
                  </div>

                  <div class="agent-skill-picker__list">
                    <button
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': !selectedSkillIds.length }"
                      @click="selectAutoSkill"
                    >
                      <strong>自动选择</strong>
                    </button>

                    <button
                      v-for="item in skills"
                      :key="item.skillId"
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': selectedSkillIds.includes(item.skillId) }"
                      @click="toggleSkillSelection(item.skillId)"
                    >
                      <strong>{{ item.name }}</strong>
                    </button>
                  </div>
                </div>

                <div v-else-if="activeSessionExtraTab === 'mcp'" class="agent-session-extra__section">
                  <div class="agent-session-extra__section-head">
                    <div>
                      <p>MCP</p>
                      <small>{{ selectedMcpServerLabel }}</small>
                    </div>
                    <button type="button" :disabled="isLoadingMcpServers" @click="$emit('refresh-mcp-servers')">
                      {{ isLoadingMcpServers ? '读取中' : '刷新' }}
                    </button>
                  </div>

                  <div class="agent-skill-picker__list">
                    <button
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': isMcpDisabled }"
                      @click="selectNoMcpServers"
                    >
                      <strong>不使用 MCP</strong>
                      <small>本轮不暴露任何 MCP 工具</small>
                    </button>

                    <button
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': isAllMcpSelected }"
                      @click="selectAllMcpServers"
                    >
                      <strong>全部可用 MCP</strong>
                      <small>不限制本轮可用 MCP 服务</small>
                    </button>

                    <button
                      v-for="item in mcpServers"
                      :key="item.serverId"
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': selectedConcreteMcpServerIds.includes(item.serverId), 'is-disabled': item.status !== 'ready' }"
                      @click="toggleMcpServerSelection(item.serverId)"
                    >
                      <strong>{{ item.name }}</strong>
                      <small>{{ item.status === 'ready' ? `${item.toolCount || 0} 个工具` : (item.error || item.status || '不可用') }}</small>
                    </button>
                  </div>

                  <small v-if="mcpServerError || !mcpServers.length" class="agent-session-extra__hint">
                    {{ mcpServerError || '当前没有可用的 MCP 服务。' }}
                  </small>
                </div>

                <div v-else-if="activeSessionExtraTab === 'embedding'" class="agent-session-extra__section">
                  <div class="agent-session-extra__section-head">
                    <div>
                      <p>Embedding</p>
                      <small>{{ selectedEmbeddingConfigLabel }}</small>
                    </div>
                    <span>{{ embeddingConfigs.length }} 个</span>
                  </div>

                  <div class="agent-skill-picker__list">
                    <button
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': !selectedEmbeddingAiId }"
                      @click="selectDefaultEmbedding"
                    >
                      <strong>默认 embedding</strong>
                      <small>使用服务器默认配置</small>
                    </button>

                    <button
                      v-for="item in embeddingConfigs"
                      :key="item.aiId"
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': selectedEmbeddingAiId === item.aiId }"
                      @click="selectEmbeddingConfig(item.aiId)"
                    >
                      <strong>{{ item.label }}</strong>
                      <small>{{ item.versions?.[0] || item.aiBaseUrl || 'embedding' }}</small>
                    </button>
                  </div>
                  <small v-if="!embeddingConfigs.length" class="agent-session-extra__hint">
                    当前没有可选 embedding 配置。
                  </small>
                </div>

                <div v-else class="agent-session-extra__section">
                  <div class="agent-session-extra__section-head">
                    <div>
                      <p>RAG</p>
                      <small>{{ selectedRagCollectionLabel }}</small>
                    </div>
                    <span>{{ ragCollections.length }} 个</span>
                  </div>

                  <div class="agent-skill-picker__list">
                    <button
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': !normalizedSelectedRagCollectionIds.length }"
                      @click="selectNoRagCollections"
                    >
                      <strong>不使用知识库</strong>
                      <small>本轮不注入 RAG 检索结果</small>
                    </button>

                    <button
                      v-for="item in ragCollections"
                      :key="item.collectionId"
                      type="button"
                      class="agent-skill-option"
                      :class="{ 'is-active': normalizedSelectedRagCollectionIds.includes(item.collectionId) }"
                      @click="toggleRagCollectionSelection(item.collectionId)"
                    >
                      <strong>{{ item.name }}</strong>
                      <small>{{ item.documentCount || 0 }} 个文档 · {{ item.chunkCount || 0 }} 个切片</small>
                    </button>

                    <button
                      v-for="collectionId in staleSelectedRagCollectionIds"
                      :key="collectionId"
                      type="button"
                      class="agent-skill-option is-active"
                      @click="toggleRagCollectionSelection(collectionId)"
                    >
                      <strong>已选择知识库</strong>
                      <small>{{ collectionId }}</small>
                    </button>
                  </div>
                  <small v-if="ragCollectionError" class="agent-session-extra__hint">{{ ragCollectionError }}</small>
                </div>
              </section>
            </div>
          </section>
        </div>
      </Transition>

      <Transition name="skill-picker-fade">
        <div
          v-if="expiredAttachmentNotice"
          class="agent-skill-picker"
          role="dialog"
          aria-modal="true"
          aria-label="上传文件已失效"
          @click.self="$emit('dismiss-expired-attachment-notice')"
        >
          <section class="agent-skill-picker__panel agent-skill-picker__panel--notice">
            <div class="agent-skill-picker__head">
              <div>
                <p class="agent-panel__eyebrow">临时文件提醒</p>
                <h3>之前上传的文件已失效</h3>
                <small>这些文件只会保留在当前浏览器会话中。刷新页面或重新打开后，需要重新上传。</small>
              </div>
              <button
                type="button"
                class="agent-skill-picker__close"
                aria-label="关闭文件失效提醒"
                @click="$emit('dismiss-expired-attachment-notice')"
              >
                ×
              </button>
            </div>

            <div v-if="expiredAttachmentNotice.names?.length" class="agent-skill-picker__expired-list">
              <p>已失效的文件：</p>
              <div class="agent-skill-picker__expired-chips">
                <span
                  v-for="name in expiredAttachmentNotice.names"
                  :key="name"
                  class="agent-skill-picker__expired-chip"
                >
                  {{ name }}
                </span>
              </div>
            </div>

            <div class="agent-skill-picker__footer">
              <button
                type="button"
                class="agent-skill-picker__confirm"
                @click="$emit('dismiss-expired-attachment-notice')"
              >
                我知道了
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </section>

    <aside
      class="agent-shell__inspector"
      :class="{ 'is-collapsed': isInspectorCollapsed }"
      @click="handleInspectorClick"
    >
      <button
        type="button"
        class="agent-inspector__toggle"
        :aria-label="isInspectorCollapsed ? '展开模型信息' : '收起模型信息'"
        @click="toggleInspectorCollapsed"
      >
        {{ isInspectorCollapsed ? '‹' : '›' }}
      </button>

      <section class="agent-panel agent-inspector__panel" :class="{ 'is-hidden': isInspectorCollapsed }">
        <div class="agent-panel__head">
          <p class="agent-panel__eyebrow">模型信息</p>
          <h3>当前配置</h3>
        </div>

        <div class="agent-panel__stack">
          <article class="agent-info-card">
            <span class="agent-info-card__label">当前模式</span>
            <strong class="agent-info-card__value">{{ resolvedWorkspaceMode.label }}</strong>
          </article>

          <article class="agent-info-card agent-info-card--model-config">
            <div class="agent-info-card__field">
              <span class="agent-info-card__label">AI 配置</span>
              <select
                class="agent-info-card__select"
                :value="selectedAiId"
                :disabled="isLoadingAiConfigs || !aiConfigs.length"
                @change="$emit('update:ai-id', $event.target.value)"
              >
                <option value="">请选择配置</option>
                <option
                  v-for="item in aiConfigs"
                  :key="item.aiId"
                  :value="item.aiId"
                >
                  {{ item.label }}
                </option>
              </select>
            </div>

            <div class="agent-info-card__field">
              <span class="agent-info-card__label">当前模型</span>
              <select
                class="agent-info-card__select"
                :value="selectedModel"
                :disabled="!modelOptions.length"
                @change="$emit('update:model', $event.target.value)"
              >
                <option value="">{{ modelOptions.length ? '请选择模型' : '暂无可选模型' }}</option>
                <option
                  v-for="item in modelOptions"
                  :key="item"
                  :value="item"
                >
                  {{ item }}
                </option>
              </select>
            </div>

            <button
              type="button"
              class="agent-info-card__config-button"
              :disabled="isLoadingSkills"
              @click="toggleSkillPicker"
            >
              其他配置
            </button>
          </article>

          <article class="agent-info-card agent-info-card--files">
            <span class="agent-info-card__label">会话文件</span>
            <strong class="agent-info-card__value">{{ activeWorkspaceFiles.length ? `${activeWorkspaceFiles.length} 个文件` : '暂无文件' }}</strong>
            <small class="agent-info-card__meta">
              {{ activeWorkspaceFiles.length ? `当前对话已归档 ${activeWorkspaceFiles.length} 个文件` : '当前对话还没有生成或修改文件。' }}
            </small>

            <div v-if="activeWorkspaceFiles.length" class="agent-file-list">
              <article
                v-for="item in activeWorkspaceFiles"
                :key="item.artifactPath || item.path"
                class="agent-file-item"
                :class="{ 'is-active': item.path === selectedWorkspaceFilePath }"
                :title="item.path"
                @click="handleWorkspaceFileClick(item.path)"
              >
                <span class="agent-file-item__icon" aria-hidden="true">📄</span>
                <strong class="agent-file-item__path">{{ getFileDisplayName(item.path) }}</strong>
              </article>
            </div>
          </article>
        </div>
      </section>
    </aside>

    <div
      class="agent-shell__resizer"
      :class="{ 'is-visible': hasWorkspaceFilePreview }"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整代码预览宽度"
      :aria-hidden="hasWorkspaceFilePreview ? 'false' : 'true'"
      @pointerdown="startPreviewResize"
    ></div>

    <aside
      class="agent-shell__preview"
      :class="{ 'is-visible': hasWorkspaceFilePreview }"
      :aria-hidden="hasWorkspaceFilePreview ? 'false' : 'true'"
    >
      <section class="agent-code-viewer">
        <div class="agent-code-viewer__head">
          <div class="agent-code-viewer__head-copy">
            <p class="agent-panel__eyebrow">文件预览</p>
            <h3>{{ selectedWorkspaceFileDisplayName }}</h3>
            <small>{{ selectedWorkspaceFileMeta }}</small>
          </div>
          <button
            type="button"
            class="agent-code-viewer__close"
            aria-label="收起文件预览"
            @click="$emit('close-workspace-file')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 6L15 12L9 18"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.9"
              />
            </svg>
          </button>
        </div>

        <p v-if="workspaceFileError" class="form-error agent-code-viewer__status">{{ workspaceFileError }}</p>
        <p v-else-if="isLoadingWorkspaceFile" class="agent-code-viewer__status">正在读取文件内容...</p>

        <div v-else class="agent-code-viewer__body-wrap">
          <div v-if="hasCopiedWorkspaceFile" class="agent-code-viewer__copy-toast" role="status" aria-live="polite">
            已复制到剪贴板
          </div>
          <button
            type="button"
            class="agent-code-viewer__copy agent-code-viewer__copy--overlay"
            :class="{ 'is-copied': hasCopiedWorkspaceFile }"
            :disabled="!normalizedWorkspaceFileContent || isLoadingWorkspaceFile"
            :aria-label="hasCopiedWorkspaceFile ? '代码已复制' : (isCopyingWorkspaceFile ? '正在复制代码' : '复制代码')"
            @click="copyWorkspaceFileContent"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7" />
              <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
          </button>
          <pre class="agent-code-viewer__body"><code class="hljs" v-html="renderedWorkspaceFileContent"></code></pre>
        </div>
      </section>
    </aside>
  </div>
</template>

<script setup>
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const TASK_STATUS_LABELS = {
  idle: '待开始',
  queued: '排队中',
  pending: '待执行',
  running: '执行中',
  in_progress: '进行中',
  waiting_for_user: '等待你的回复',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}
const LARK_CHAT_LIST_MARKER_START = ':::agent-lark-chat-list'
const LARK_CHAT_LIST_MARKER_END = ':::'
const MCP_DISABLED_SELECTION = '__mcp_disabled__'
const MCP_ALL_SELECTION = '__mcp_all__'

const props = defineProps({
  activeSessionId: { type: String, default: '' },
  activeSessionTitle: { type: String, default: '当前会话' },
  contextMemorySummary: { type: String, default: '' },
  contextMemoryConfig: { type: Object, default: () => ({}) },
  contextMessageCount: { type: Number, default: 0 },
  activeWorkspaceFiles: { type: Array, default: () => [] },
  activeWorkspaceFolder: { type: String, default: '' },
  aiConfigs: { type: Array, default: () => [] },
  embeddingConfigs: { type: Array, default: () => [] },
  canSend: { type: Boolean, default: false },
  chatError: { type: String, default: '' },
  draft: { type: String, default: '' },
  ephemeralAttachments: { type: Array, default: () => [] },
  expiredAttachmentNotice: { type: Object, default: null },
  isAgentRunning: { type: Boolean, default: false },
  isCreatingSession: { type: Boolean, default: false },
  isCancellingTask: { type: Boolean, default: false },
  isLoadingAiConfigs: { type: Boolean, default: false },
  isLoadingLarkChats: { type: Boolean, default: false },
  isLoadingMcpServers: { type: Boolean, default: false },
  isLoadingSkills: { type: Boolean, default: false },
  isLoadingSession: { type: Boolean, default: false },
  isLoadingSessions: { type: Boolean, default: false },
  isLoadingWorkspaceFile: { type: Boolean, default: false },
  isRefreshingActiveSession: { type: Boolean, default: false },
  isSending: { type: Boolean, default: false },
  loadError: { type: String, default: '' },
  larkChatError: { type: String, default: '' },
  larkChats: { type: Array, default: () => [] },
  mcpServerError: { type: String, default: '' },
  mcpServers: { type: Array, default: () => [] },
  messages: { type: Array, default: () => [] },
  modelOptions: { type: Array, default: () => [] },
  hideSidebar: { type: Boolean, default: false },
  selectedAgentLabel: { type: String, default: '' },
  selectedAiId: { type: String, default: '' },
  selectedModel: { type: String, default: '' },
  selectedModelLabel: { type: String, default: '' },
  selectedMcpServerIds: { type: Array, default: () => [] },
  selectedMcpServerLabel: { type: String, default: '不使用 MCP' },
  selectedLarkChatId: { type: String, default: '' },
  selectedLarkChatLabel: { type: String, default: '未设置默认群聊' },
  selectedRagCollectionId: { type: String, default: '' },
  selectedRagCollectionIds: { type: Array, default: () => [] },
  selectedRagCollectionLabel: { type: String, default: '不使用知识库' },
  selectedEmbeddingAiId: { type: String, default: '' },
  ragCollections: { type: Array, default: () => [] },
  ragCollectionError: { type: String, default: '' },
  selectedSkillIds: { type: Array, default: () => [] },
  selectedSkillLabel: { type: String, default: '自动选择' },
  skills: { type: Array, default: () => [] },
  selectedWorkspaceFileContent: { type: String, default: '' },
  selectedWorkspaceFilePath: { type: String, default: '' },
  selectedWorkspaceFileSizeBytes: { type: Number, default: null },
  selectedWorkspaceFileUpdatedAt: { type: String, default: '' },
  sessionError: { type: String, default: '' },
  sessions: { type: Array, default: () => [] },
  task: { type: Object, default: null },
  username: { type: String, default: '访客' },
  workspaceMode: { type: Object, default: () => ({}) },
  workspaceFileError: { type: String, default: '' }
})

const emit = defineEmits([
  'create-session',
  'cancel-task',
  'close-workspace-file',
  'delete-session',
  'dismiss-expired-attachment-notice',
  'logout',
  'open-model-config',
  'open-workspace-file',
  'refresh-lark-chats',
  'refresh-mcp-servers',
  'refresh-session',
  'remove-ephemeral-attachment',
  'select-session',
  'select-lark-chat',
  'send',
  'upload-attachments',
  'update:ai-id',
  'update:draft',
  'update:lark-chat-id',
  'update:mcp-server-ids',
  'update:model',
  'update:rag-collection-id',
  'update:rag-collection-ids',
  'update:embedding-ai-id',
  'update:skill-ids'
])

const attachmentInputRef = ref(null)
const composerRef = ref(null)
const messagesRef = ref(null)
const shellRef = ref(null)
const expandedToolMessages = ref({})
const shouldRestoreFocus = ref(false)
const isCopyingWorkspaceFile = ref(false)
const hasCopiedWorkspaceFile = ref(false)
const conversationCopyToast = ref(false)
const copyingMessageId = ref('')
const previewWidth = ref(520)
const isInspectorCollapsed = ref(false)
const isSkillPickerOpen = ref(false)
const isResizingPreview = ref(false)
const activeSessionExtraTab = ref('skill')
const suppressAutoOpen = ref(false)
const hasInitializedWorkspaceFilesForSession = ref(false)
const renderedWorkspaceFileContent = ref('')
let activeResizePointerId = null
let workspaceFileCopyResetTimer = null
let conversationCopyToastTimer = null
let suppressAutoOpenTimer = null
let workspaceFileHighlightTimer = null
let workspaceFileHighlightFrameId = null

const userInitial = computed(() => {
  const normalized = String(props.username || '').trim()
  return normalized ? normalized.slice(0, 1).toUpperCase() : 'A'
})

const taskStatusLabel = computed(() => {
  const normalizedStatus = String(props.task?.status || '').trim().toLowerCase()
  return TASK_STATUS_LABELS[normalizedStatus] || '待处理中'
})

const taskStatusTone = computed(() => {
  const normalizedStatus = String(props.task?.status || '').trim().toLowerCase()

  if (['queued', 'pending', 'running', 'in_progress'].includes(normalizedStatus)) {
    return 'running'
  }

  if (normalizedStatus === 'completed') {
    return 'completed'
  }

  if (['failed', 'cancelled'].includes(normalizedStatus)) {
    return 'danger'
  }

  return 'idle'
})

const resolvedAgentLabel = computed(() => {
  const label = String(props.selectedAgentLabel || '').trim()
  if (label) {
    return label
  }

  if (props.isLoadingAiConfigs) {
    return '正在加载...'
  }

  return '未选择配置'
})

const resolvedModelLabel = computed(() => {
  const label = String(props.selectedModelLabel || '').trim()
  if (label) {
    return label
  }

  if (props.selectedModel) {
    return props.selectedModel
  }

  return '未选择模型'
})

const larkChatStatusText = computed(() => {
  if (props.isLoadingLarkChats) {
    return '正在读取机器人所在群聊...'
  }

  if (props.larkChatError) {
    return props.larkChatError
  }

  if (!props.larkChats.length) {
    return '发送“获取群聊信息”或点击刷新群聊读取列表。'
  }

  if (props.selectedLarkChatId) {
    return `当前目标：${props.selectedLarkChatLabel || props.selectedLarkChatId}`
  }

  return `共 ${props.larkChats.length} 个可选群聊`
})

function normalizeLarkChatFromMessage(item) {
  const chatId = String(item?.chatId || item?.chat_id || '').trim()

  if (!chatId) {
    return null
  }

  return {
    chatId,
    name: String(item?.name || item?.chatName || chatId).trim() || chatId,
    description: String(item?.description || '').trim()
  }
}

function parseLarkChatListMessage(content) {
  const normalizedContent = String(content || '').trim()
  const markerIndex = normalizedContent.indexOf(LARK_CHAT_LIST_MARKER_START)

  if (markerIndex < 0) {
    return {
      intro: normalizedContent,
      items: [],
      tool: ''
    }
  }

  const intro = normalizedContent.slice(0, markerIndex).trim()
  const payloadStart = markerIndex + LARK_CHAT_LIST_MARKER_START.length
  const payloadEnd = normalizedContent.indexOf(LARK_CHAT_LIST_MARKER_END, payloadStart)
  const payloadText = normalizedContent
    .slice(payloadStart, payloadEnd >= 0 ? payloadEnd : undefined)
    .trim()

  try {
    const payload = JSON.parse(payloadText)

    return {
      intro: intro || '点击下面的群聊，后续对话会默认使用该群。',
      items: Array.isArray(payload?.items)
        ? payload.items.map((item) => normalizeLarkChatFromMessage(item)).filter(Boolean)
        : [],
      tool: String(payload?.tool || '').trim()
    }
  } catch {
    return {
      intro: intro || '群聊列表解析失败，请重新发送“获取群聊信息”。',
      items: [],
      tool: ''
    }
  }
}

function isLarkChatListMessage(message) {
  if (!message || typeof message !== 'object') {
    return false
  }

  if (isProgressMessage(message) || resolveMessageVariant(message) === 'tool') {
    return false
  }

  const normalizedRole = String(message.role || '').trim().toLowerCase()
  return normalizedRole === 'assistant'
    && String(message.content || '').includes(LARK_CHAT_LIST_MARKER_START)
}

function selectLarkChatFromMessage(chat) {
  const normalizedChat = normalizeLarkChatFromMessage(chat)

  if (!normalizedChat) {
    return
  }

  emit('select-lark-chat', normalizedChat)
}

function toggleSkillPicker() {
  if (props.isLoadingSkills) {
    return
  }

  isSkillPickerOpen.value = !isSkillPickerOpen.value
}

function closeSkillPicker() {
  isSkillPickerOpen.value = false
}

function handleInspectorClick(event) {
  if (!isSkillPickerOpen.value) {
    return
  }

  const target = event?.target

  if (target instanceof Element && target.closest('.agent-info-card--model-config')) {
    return
  }

  closeSkillPicker()
}

function selectAutoSkill() {
  emit('update:skill-ids', [])
}

function selectNoMcpServers() {
  emit('update:mcp-server-ids', [MCP_DISABLED_SELECTION])
}

function selectAllMcpServers() {
  emit('update:mcp-server-ids', [MCP_ALL_SELECTION])
}

function toggleSkillSelection(skillId) {
  const normalizedSkillId = String(skillId || '').trim()

  if (!normalizedSkillId) {
    return
  }

  const nextSkillIds = Array.isArray(props.selectedSkillIds)
    ? [...props.selectedSkillIds]
    : []
  const existingIndex = nextSkillIds.indexOf(normalizedSkillId)

  if (existingIndex >= 0) {
    nextSkillIds.splice(existingIndex, 1)
  } else {
    nextSkillIds.push(normalizedSkillId)
  }

  emit('update:skill-ids', nextSkillIds)
}

function toggleMcpServerSelection(serverId) {
  const normalizedServerId = String(serverId || '').trim()

  if (!normalizedServerId) {
    return
  }

  const server = props.mcpServers.find((item) => item.serverId === normalizedServerId)

  if (server && server.status !== 'ready') {
    return
  }

  const nextServerIds = selectedConcreteMcpServerIds.value.slice()
  const existingIndex = nextServerIds.indexOf(normalizedServerId)

  if (existingIndex >= 0) {
    nextServerIds.splice(existingIndex, 1)
  } else {
    nextServerIds.push(normalizedServerId)
  }

  emit('update:mcp-server-ids', nextServerIds)
}

function selectDefaultEmbedding() {
  emit('update:embedding-ai-id', '')
}

function selectEmbeddingConfig(aiId) {
  emit('update:embedding-ai-id', String(aiId || '').trim())
}

function selectNoRagCollections() {
  emit('update:rag-collection-ids', [])
  emit('update:rag-collection-id', '')
}

function toggleRagCollectionSelection(collectionId) {
  const normalizedCollectionId = String(collectionId || '').trim()

  if (!normalizedCollectionId) {
    return
  }

  const nextCollectionIds = normalizedSelectedRagCollectionIds.value.slice()
  const existingIndex = nextCollectionIds.indexOf(normalizedCollectionId)

  if (existingIndex >= 0) {
    nextCollectionIds.splice(existingIndex, 1)
  } else {
    nextCollectionIds.push(normalizedCollectionId)
  }

  emit('update:rag-collection-ids', nextCollectionIds)
  emit('update:rag-collection-id', nextCollectionIds[0] || '')
}

const resolvedWorkspaceMode = computed(() => {
  const label = String(props.workspaceMode?.label || '').trim()
  const tone = String(props.workspaceMode?.tone || '').trim()
  const hint = String(props.workspaceMode?.hint || '').trim()

  return {
    label: label || '对话模式',
    tone: tone || 'chat',
    hint: hint || '当前以普通对话方式处理请求。'
  }
})

const selectedEmbeddingConfig = computed(() => {
  const configId = String(props.selectedEmbeddingAiId || '').trim()

  if (!configId) {
    return null
  }

  return props.embeddingConfigs.find((item) => item.aiId === configId) || null
})

const selectedEmbeddingConfigLabel = computed(() => (
  selectedEmbeddingConfig.value?.label || '使用服务器默认 embedding'
))

const normalizedSelectedRagCollectionIds = computed(() => {
  const explicitIds = Array.isArray(props.selectedRagCollectionIds)
    ? props.selectedRagCollectionIds
    : []
  const fallbackId = String(props.selectedRagCollectionId || '').trim()
  const sourceIds = explicitIds.length ? explicitIds : (fallbackId ? [fallbackId] : [])

  return [...new Set(
    sourceIds
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )]
})

const staleSelectedRagCollectionIds = computed(() => (
  normalizedSelectedRagCollectionIds.value.filter((collectionId) => (
    !props.ragCollections.some((item) => item.collectionId === collectionId)
  ))
))

const isMcpDisabled = computed(() => (
  Array.isArray(props.selectedMcpServerIds)
  && props.selectedMcpServerIds.includes(MCP_DISABLED_SELECTION)
))

const isAllMcpSelected = computed(() => (
  Array.isArray(props.selectedMcpServerIds)
  && props.selectedMcpServerIds.includes(MCP_ALL_SELECTION)
))

const selectedConcreteMcpServerIds = computed(() => (
  Array.isArray(props.selectedMcpServerIds)
    ? props.selectedMcpServerIds.filter((serverId) => (
        serverId !== MCP_DISABLED_SELECTION && serverId !== MCP_ALL_SELECTION
      ))
    : []
))

const sessionExtraSummary = computed(() => {
  const parts = []

  if (Array.isArray(props.selectedSkillIds) && props.selectedSkillIds.length) {
    parts.push(`Skill ${props.selectedSkillIds.length}`)
  }

  if (isAllMcpSelected.value) {
    parts.push('MCP 全部')
  } else if (selectedConcreteMcpServerIds.value.length) {
    parts.push(`MCP ${selectedConcreteMcpServerIds.value.length}`)
  }

  if (String(props.selectedEmbeddingAiId || '').trim()) {
    parts.push('Embedding')
  }

  if (normalizedSelectedRagCollectionIds.value.length) {
    parts.push(`RAG ${normalizedSelectedRagCollectionIds.value.length}`)
  }

  return parts.length ? parts.join(' · ') : '自动选择'
})

const sessionExtraTabs = computed(() => [
  {
    id: 'skill',
    label: 'Skill',
    summary: Array.isArray(props.selectedSkillIds) && props.selectedSkillIds.length
      ? `${props.selectedSkillIds.length} 个技能`
      : '自动选择'
  },
  {
    id: 'mcp',
    label: 'MCP',
    summary: props.selectedMcpServerLabel
  },
  {
    id: 'embedding',
    label: 'Embedding',
    summary: selectedEmbeddingConfigLabel.value
  },
  {
    id: 'rag',
    label: 'RAG',
    summary: normalizedSelectedRagCollectionIds.value.length
      ? props.selectedRagCollectionLabel
      : '不使用'
  }
])

const resolvedWorkspaceFolder = computed(() => {
  const folder = String(props.activeWorkspaceFolder || '').trim()

  if (folder) {
    return folder
  }

  if (props.activeSessionId) {
    return `session-files/${props.activeSessionId}`
  }

  return 'session-files/<current-session>'
})

const hasWorkspaceFilePreview = computed(() => (
  Boolean(
    String(props.selectedWorkspaceFilePath || '').trim()
    || String(props.workspaceFileError || '').trim()
    || props.isLoadingWorkspaceFile
  )
))

const shellStyle = computed(() => (
  {
    '--agent-preview-width': `${previewWidth.value}px`,
    '--agent-inspector-width': isInspectorCollapsed.value ? '24px' : '308px'
  }
))

const selectedWorkspaceLanguage = computed(() => {
  const normalizedPath = String(props.selectedWorkspaceFilePath || '').trim().toLowerCase()

  if (!normalizedPath.includes('.')) {
    return ''
  }

  const extension = normalizedPath.split('.').pop() || ''
  const extensionMap = {
    html: 'xml',
    htm: 'xml',
    vue: 'xml',
    xml: 'xml',
    svg: 'xml',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',
    py: 'python',
    pyi: 'python',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    sh: 'bash',
    bash: 'bash',
    yml: 'yaml',
    yaml: 'yaml'
  }

  return extensionMap[extension] || ''
})

const selectedWorkspaceFileMeta = computed(() => {
  const sizeBytes = Number(props.selectedWorkspaceFileSizeBytes)
  const sizeLabel = Number.isFinite(sizeBytes)
    ? (sizeBytes >= 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${sizeBytes} B`)
    : ''
  const updatedAt = String(props.selectedWorkspaceFileUpdatedAt || '').trim()
  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : ''

  return [sizeLabel, updatedLabel].filter(Boolean).join(' · ')
})

const selectedWorkspaceFileDisplayName = computed(() => {
  return getFileDisplayName(props.selectedWorkspaceFilePath)
})

function decodeEscapedPreviewContent(value) {
  const rawContent = String(value || '')

  if (!rawContent) {
    return ''
  }

  const actualLineBreaks = (rawContent.match(/\r?\n/g) || []).length
  const escapedLineBreaks = (rawContent.match(/\\n/g) || []).length
  const escapedQuotes = (rawContent.match(/\\"/g) || []).length
  const looksEscaped = escapedLineBreaks > 0 || escapedQuotes > 0

  if (!looksEscaped) {
    return rawContent
  }

  if (actualLineBreaks > escapedLineBreaks && actualLineBreaks > 2) {
    return rawContent
  }

  return rawContent
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, '\'')
    .replace(/\\\\/g, '\\')
}

const normalizedWorkspaceFileContent = computed(() => (
  decodeEscapedPreviewContent(props.selectedWorkspaceFileContent)
))

function escapeWorkspacePreviewHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function shouldSkipSyntaxHighlight(content, language) {
  const normalizedContent = String(content || '')
  const lineCount = normalizedContent.split(/\r?\n/).length

  if (!language) {
    return true
  }

  if (normalizedContent.length > 16000) {
    return true
  }

  if (lineCount > 500) {
    return true
  }

  return false
}

function buildHighlightedWorkspaceFileContent() {
  const content = normalizedWorkspaceFileContent.value

  if (!content) {
    return ''
  }

  const language = selectedWorkspaceLanguage.value

  if (!hljs.getLanguage(language) || shouldSkipSyntaxHighlight(content, language)) {
    return escapeWorkspacePreviewHtml(content)
  }

  try {
    return hljs.highlight(content, {
      language,
      ignoreIllegals: true
    }).value
  } catch {
    return escapeWorkspacePreviewHtml(content)
  }
}

function cancelWorkspaceFileHighlightSchedule() {
  if (workspaceFileHighlightTimer) {
    clearTimeout(workspaceFileHighlightTimer)
    workspaceFileHighlightTimer = null
  }

  if (workspaceFileHighlightFrameId !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(workspaceFileHighlightFrameId)
    workspaceFileHighlightFrameId = null
  }
}

function scheduleWorkspaceFileHighlight() {
  cancelWorkspaceFileHighlightSchedule()

  const content = normalizedWorkspaceFileContent.value

  if (!content) {
    renderedWorkspaceFileContent.value = ''
    return
  }

  renderedWorkspaceFileContent.value = escapeWorkspacePreviewHtml(content)

  if (!hasWorkspaceFilePreview.value) {
    return
  }

  workspaceFileHighlightTimer = setTimeout(() => {
    workspaceFileHighlightTimer = null

    if (typeof window === 'undefined') {
      renderedWorkspaceFileContent.value = buildHighlightedWorkspaceFileContent()
      return
    }

    workspaceFileHighlightFrameId = window.requestAnimationFrame(() => {
      workspaceFileHighlightFrameId = null
      renderedWorkspaceFileContent.value = buildHighlightedWorkspaceFileContent()
    })
  }, 180)
}

const resolvedComposerPlaceholder = computed(() => {
  if (props.isAgentRunning) {
    return '当前还在处理中，等这一轮完成后再继续发送消息'
  }

  return '输入问题、想法或任务，Enter 发送，Shift+Enter 换行'
})

const resolvedSendButtonLabel = computed(() => {
  if (props.isSending) {
    return '发送中...'
  }

  if (props.isAgentRunning) {
    return '处理中...'
  }

  return '发送消息'
})

function formatEphemeralAttachmentMeta(item) {
  const sizeLabel = (() => {
    const sizeBytes = Number(item?.sizeBytes)

    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
      return ''
    }

    if (sizeBytes >= 1024 * 1024) {
      return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    }

    if (sizeBytes >= 1024) {
      return `${(sizeBytes / 1024).toFixed(1)} KB`
    }

    return `${sizeBytes} B`
  })()

  const typeLabel = String(item?.type || '').trim()
  return [sizeLabel, typeLabel].filter(Boolean).join(' · ')
}

const totalTokens = computed(() => {
  if (!Array.isArray(props.messages)) {
    return 0
  }

  return props.messages.reduce((sum, message) => {
    const usage = message?.usage
    const totalTokens = Number(usage?.totalTokens)

    if (Number.isFinite(totalTokens) && totalTokens > 0) {
      return sum + totalTokens
    }

    return sum
  }, 0)
})

const formattedTotalTokens = computed(() => {
  const tokens = totalTokens.value

  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M tokens`
  }

  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K tokens`
  }

  return `${tokens} tokens`
})

const contextMemoryThreshold = computed(() => {
  const value = Number(props.contextMemoryConfig?.thresholdMessages)
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 24
})

const contextMessageCount = computed(() => {
  const explicitValue = Number(props.contextMessageCount)

  if (Number.isFinite(explicitValue) && explicitValue >= 0) {
    return Math.round(explicitValue)
  }

  return Array.isArray(props.messages) ? props.messages.length : 0
})

const contextUsagePercent = computed(() => {
  if (props.contextMemoryConfig?.enabled === false) {
    return 0
  }

  return Math.min(100, Math.round((contextMessageCount.value / contextMemoryThreshold.value) * 100))
})

const formattedContextUsage = computed(() => {
  if (props.contextMemoryConfig?.enabled === false) {
    return '关闭'
  }

  return `${contextUsagePercent.value}%`
})

const contextUsageAriaLabel = computed(() => {
  if (props.contextMemoryConfig?.enabled === false) {
    return '上下文压缩未启用'
  }

  return `上下文使用率 ${formattedContextUsage.value}`
})

function isProgressMessage(message) {
  return String(message?.messageId || '').startsWith('progress-')
}

function isPartialAssistantMessage(message) {
  return String(message?.messageId || '').startsWith('partial-')
}

function resolveMessageVariant(messageOrRole) {
  if (messageOrRole && typeof messageOrRole === 'object') {
    if (isProgressMessage(messageOrRole)) {
      return 'progress'
    }

    if (isPartialAssistantMessage(messageOrRole)) {
      return 'assistant'
    }
  }

  const role = typeof messageOrRole === 'object' ? messageOrRole?.role : messageOrRole
  const normalizedRole = String(role || '').trim().toLowerCase()

  if (normalizedRole === 'user') {
    return 'user'
  }

  if (normalizedRole === 'tool') {
    return 'tool'
  }

  return 'assistant'
}

function resolveMessageLabel(role) {
  const normalizedRole = String(role || '').trim().toLowerCase()

  if (normalizedRole === 'user') {
    return '你'
  }

  if (normalizedRole === 'tool') {
    return '工具'
  }

  return 'Agent'
}

function resolveMessageLabelForDisplay(role) {
  const normalizedRole = String(role || '').trim().toLowerCase()

  if (normalizedRole === 'user') {
    return '你'
  }

  if (normalizedRole === 'tool') {
    return '工具'
  }

  return 'Agent'
}

function formatMessageContent(content, role) {
  const normalizedContent = String(content || '').trim()

  if (role === 'user') {
    return normalizedContent
  }

  const lowerContent = normalizedContent.toLowerCase()

  if (lowerContent.includes('tool summary:') && lowerContent.includes('status: failed')) {
    const lines = normalizedContent.split('\n')
    const toolMatch = lines.find(line => line.toLowerCase().includes('tool:'))
    const toolName = toolMatch ? toolMatch.replace(/tool:\s*/i, '').trim() : '工具'

    if (lowerContent.includes('matched') && lowerContent.includes('snippets')) {
      const snippetMatch = normalizedContent.match(/(\d+)\s+snippets/)
      const count = snippetMatch ? snippetMatch[1] : '多个'
      return `工具摘要：\n工具：${toolName}\n状态：失败\n\n${toolName} 在文件中找到了 ${count} 个相同的内容，不确定要修改哪一个。\n\n建议：请提供更多上下文来唯一标识要修改的位置，或者直接告诉助手“全部替换”。`
    }

    if (lowerContent.includes('no match found') || lowerContent.includes('did not match')) {
      return `工具摘要：\n工具：${toolName}\n状态：失败\n\n${toolName} 没有在文件中找到要修改的内容。\n\n建议：文件内容可能已经变化，请让助手重新检查文件内容后再修改。`
    }

    if (lowerContent.includes('matchindex is required')) {
      return `工具摘要：\n工具：${toolName}\n状态：失败\n\n${toolName} 在文件中找到了多个相同的内容，不确定要修改哪一个。\n\n建议：请补充更多上下文，或使用“全部替换”的方式。`
    }
  }

  if (lowerContent.includes('model returned a final action without a reply')) {
    return '助手执行了操作，但没有给出说明。建议重新发起请求，并要求明确说明修改结果。'
  }

  return normalizedContent
}

function formatMessageContentForDisplay(content, role) {
  const normalizedRole = String(role || '').trim().toLowerCase()
  let normalizedContent = String(content || '').trim()

  if (normalizedRole === 'user') {
    return normalizedContent
  }

  if (normalizedRole === 'tool') {
    return normalizedContent
  }

  const fenceMatch = normalizedContent.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]+?)\n?```\s*$/)

  if (fenceMatch?.[1]) {
    normalizedContent = fenceMatch[1].trim()
  }

  const lowerContent = normalizedContent.toLowerCase()
  const looksLikeHtmlErrorPage = (
    lowerContent.includes('<html')
    && lowerContent.includes('<title>')
    && (
      lowerContent.includes('404 not found')
      || lowerContent.includes('openresty')
      || lowerContent.includes('<center><h1>')
    )
  )

  if (looksLikeHtmlErrorPage) {
    return 'AI 接口返回了一个 HTML 错误页，通常表示当前模型配置的 AI Base URL 不正确。请检查模型配置中的接口地址。'
  }

  const lt = '<'
  const highConfidenceMarkers = [
    lt + '!doctype html',
    lt + 'html',
    'export default',
    'body {',
    '.container {'
  ]

  const hasHighConfidenceMarker = highConfidenceMarkers.some((marker) => lowerContent.includes(marker))
  const codeBlockMatch = lowerContent.match(/```/g)
  const hasMultipleCodeBlocks = codeBlockMatch && codeBlockMatch.length >= 2
  const hasStyleOrScriptBlock = (
    (lowerContent.includes(lt + 'style') && lowerContent.includes(lt + '/style>'))
    || (lowerContent.includes(lt + 'script') && lowerContent.includes(lt + '/script>'))
    || (lowerContent.includes(lt + 'template>') && lowerContent.includes(lt + '/template>'))
  )

  const lineCount = normalizedContent.split(/\r?\n/).length
  const isLongEnough = normalizedContent.length >= 220 || lineCount >= 8
  const looksLikeCodeHeavyMessage = hasMultipleCodeBlocks || hasStyleOrScriptBlock || (hasHighConfidenceMarker && isLongEnough)

  if (lowerContent.includes('tool summary:') && !lowerContent.includes('status: failed')) {
    return '本轮主要执行了文件或工具操作，代码正文已省略，请查看右侧会话文件。'
  }

  if (looksLikeCodeHeavyMessage) {
    return '本轮返回的是代码或文件内容，对话区已省略，请查看右侧会话文件。'
  }

  if (lowerContent.includes('tool summary:') && lowerContent.includes('status: failed')) {
    const lines = normalizedContent.split('\n')
    const toolMatch = lines.find((line) => line.toLowerCase().includes('tool:'))
    const toolName = toolMatch ? toolMatch.replace(/tool:\s*/i, '').trim() : '工具'

    if (lowerContent.includes('matched') && lowerContent.includes('snippets')) {
      const snippetMatch = normalizedContent.match(/(\d+)\s+snippets/)
      const count = snippetMatch ? snippetMatch[1] : '多个'
      return `工具摘要：\n工具：${toolName}\n状态：失败\n\n${toolName} 在文件中找到了 ${count} 处相同内容，暂时无法确定该修改哪一处。\n\n建议：请补充更多上下文，或者直接要求助手“全部替换”。`
    }

    if (lowerContent.includes('no match found') || lowerContent.includes('did not match')) {
      return `工具摘要：\n工具：${toolName}\n状态：失败\n\n${toolName} 没有在文件中找到要修改的内容。\n\n建议：文件内容可能已经变化，请让助手先重新读取文件，再继续修改。`
    }

    if (lowerContent.includes('matchindex is required')) {
      return `工具摘要：\n工具：${toolName}\n状态：失败\n\n${toolName} 在文件中找到了多处相同内容，暂时无法确定该修改哪一处。\n\n建议：请补充更多上下文，或者使用“全部替换”的方式。`
    }
  }

  if (lowerContent.includes('model returned a final action without a reply')) {
    return '助手执行了操作，但没有给出说明。建议重新发起请求，并要求明确说明修改结果。'
  }

  return normalizedContent
}

function isCopyableConversationMessage(message) {
  if (!message || typeof message !== 'object') {
    return false
  }

  if (isProgressMessage(message) || isPartialAssistantMessage(message) || resolveMessageVariant(message) === 'tool') {
    return false
  }

  const normalizedRole = String(message.role || '').trim().toLowerCase()

  if (!['user', 'assistant'].includes(normalizedRole)) {
    return false
  }

  return Boolean(formatMessageContentForDisplay(message.content, message.role).trim())
}

function showConversationCopyToast() {
  conversationCopyToast.value = true

  if (conversationCopyToastTimer) {
    clearTimeout(conversationCopyToastTimer)
  }

  conversationCopyToastTimer = setTimeout(() => {
    conversationCopyToast.value = false
    conversationCopyToastTimer = null
  }, 1400)
}

async function writeTextToClipboard(content) {
  if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = content
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

async function copyConversationMessage(message) {
  const messageId = String(message?.messageId || '')
  const content = formatMessageContentForDisplay(message?.content, message?.role)

  if (!content.trim() || copyingMessageId.value) {
    return
  }

  copyingMessageId.value = messageId

  try {
    await writeTextToClipboard(content)
    showConversationCopyToast()
  } finally {
    copyingMessageId.value = ''
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
}

function flushMarkdownParagraph(paragraphLines, htmlBlocks) {
  if (!paragraphLines.length) {
    return
  }

  htmlBlocks.push(`<p>${paragraphLines.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`)
  paragraphLines.length = 0
}

function renderMarkdownHtml(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
  const htmlBlocks = []
  const paragraphLines = []
  let activeListType = ''
  let activeListItems = []

  const flushList = () => {
    if (!activeListType || !activeListItems.length) {
      activeListType = ''
      activeListItems = []
      return
    }

    const tagName = activeListType === 'ordered' ? 'ol' : 'ul'
    htmlBlocks.push(`<${tagName}>${activeListItems.map((item) => `<li>${item}</li>`).join('')}</${tagName}>`)
    activeListType = ''
    activeListItems = []
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '')
    const trimmed = line.trim()

    if (!trimmed) {
      flushMarkdownParagraph(paragraphLines, htmlBlocks)
      flushList()
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)

    if (headingMatch) {
      flushMarkdownParagraph(paragraphLines, htmlBlocks)
      flushList()
      const level = headingMatch[1].length
      htmlBlocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`)
      continue
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)

    if (orderedMatch) {
      flushMarkdownParagraph(paragraphLines, htmlBlocks)
      if (activeListType && activeListType !== 'ordered') {
        flushList()
      }
      activeListType = 'ordered'
      activeListItems.push(renderInlineMarkdown(orderedMatch[2]))
      continue
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/)

    if (unorderedMatch) {
      flushMarkdownParagraph(paragraphLines, htmlBlocks)
      if (activeListType && activeListType !== 'unordered') {
        flushList()
      }
      activeListType = 'unordered'
      activeListItems.push(renderInlineMarkdown(unorderedMatch[1]))
      continue
    }

    if (activeListType) {
      flushList()
    }

    paragraphLines.push(trimmed)
  }

  flushMarkdownParagraph(paragraphLines, htmlBlocks)
  flushList()

  return htmlBlocks.join('')
}

function looksLikeMarkdownMessage(value) {
  const normalized = String(value || '').trim()

  if (!normalized) {
    return false
  }

  return /(^|\n)#{1,6}\s+.+|(^|\n)\d+\.\s+.+|(^|\n)[-*+]\s+.+|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/m.test(normalized)
}

function shouldRenderMarkdownMessage(message) {
  if (!message || typeof message !== 'object') {
    return false
  }

  if (isProgressMessage(message) || resolveMessageVariant(message) === 'tool') {
    return false
  }

  const normalizedRole = String(message.role || '').trim().toLowerCase()

  if (normalizedRole !== 'assistant') {
    return false
  }

  return looksLikeMarkdownMessage(formatMessageContentForDisplay(message.content, message.role))
}

function renderMessageMarkdown(content, role) {
  return renderMarkdownHtml(formatMessageContentForDisplay(content, role))
}

function parseToolMessage(content) {
  const normalizedContent = String(content || '').trim()
  const lines = normalizedContent
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean)

  const skillLine = lines.find((line) => line.startsWith('技能：') || line.toLowerCase().startsWith('skill:')) || ''
  const toolLine = lines.find((line) => line.startsWith('工具：') || line.toLowerCase().startsWith('tool:')) || ''
  const statusLine = lines.find((line) => line.startsWith('状态：') || line.toLowerCase().startsWith('status:')) || ''
  const durationLine = lines.find((line) => line.startsWith('耗时：') || line.toLowerCase().startsWith('duration:')) || ''
  const targetLine = lines.find((line) => line.startsWith('目标：') || line.toLowerCase().startsWith('target:')) || ''
  const resultLineIndex = lines.findIndex((line) => line.startsWith('结果：') || line.toLowerCase().startsWith('result:'))

  let result = normalizedContent

  if (resultLineIndex >= 0) {
    const currentLine = lines[resultLineIndex]
    const inlineResult = currentLine.replace(/^(结果：|result:\s*)/i, '').trim()
    const trailingLines = lines.slice(resultLineIndex + 1)
    result = [inlineResult, ...trailingLines].filter(Boolean).join('\n').trim() || normalizedContent
  }

  const inferredStatus = statusLine
    ? statusLine.replace(/^(状态：|status:\s*)/i, '').trim().toLowerCase()
    : (/(失败|error|not found|timed out|timeout|denied|forbidden)/i.test(normalizedContent) ? 'failed' : 'success')

  const normalizedStatus = inferredStatus === '运行中' || inferredStatus === 'running'
    ? 'running'
    : (inferredStatus === '失败' || inferredStatus === 'failed' ? 'failed' : 'success')

  return {
    kind: skillLine ? 'skill' : 'tool',
    tool: (skillLine || toolLine).replace(/^(技能：|skill:\s*|工具：|tool:\s*)/i, '').trim(),
    status: normalizedStatus,
    duration: durationLine.replace(/^(耗时：|duration:\s*)/i, '').trim(),
    target: targetLine.replace(/^(目标：|target:\s*)/i, '').trim(),
    result
  }
}

function resolveToolStatusLabel(status) {
  const normalizedStatus = String(status || '').trim().toLowerCase()

  if (normalizedStatus === 'failed') {
    return '失败'
  }

  if (normalizedStatus === 'running') {
    return '执行中'
  }

  return '成功'
}

function resolveToolVisual(toolEntry) {
  const normalizedKind = String(toolEntry?.kind || '').trim().toLowerCase()
  const normalizedToolName = String(toolEntry?.tool || toolEntry || '').trim().toLowerCase()

  if (normalizedKind === 'skill') {
    return { icon: '✨', tone: 'skill' }
  }

  if (normalizedToolName === 'read_file') {
    return { icon: '📖', tone: 'read' }
  }

  if (normalizedToolName === 'list_files') {
    return { icon: '📂', tone: 'browse' }
  }

  if (normalizedToolName === 'search_text') {
    return { icon: '🔎', tone: 'search' }
  }

  if (normalizedToolName === 'run_command') {
    return { icon: '⌘', tone: 'command' }
  }

  if (normalizedToolName === 'write_file') {
    return { icon: '✍', tone: 'write' }
  }

  if (normalizedToolName === 'apply_patch') {
    return { icon: '🩹', tone: 'patch' }
  }

  return { icon: '🧰', tone: 'neutral' }
}

function formatFileMeta(item) {
  const sizeBytes = Number(item?.sizeBytes)
  const sizeLabel = Number.isFinite(sizeBytes)
    ? (sizeBytes >= 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${sizeBytes} B`)
    : ''

  const updatedAt = String(item?.updatedAt || '').trim()
  const timeLabel = updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : ''

  return [sizeLabel, timeLabel].filter(Boolean).join(' · ')
}

function getFileDisplayName(filePath) {
  const normalized = String(filePath || '').trim().replace(/\\/g, '/')

  if (!normalized) {
    return 'untitled'
  }

  const segments = normalized.split('/').filter(Boolean)
  const fileName = String(segments[segments.length - 1] || '').trim().toLowerCase()
  const parentDir = String(segments[segments.length - 2] || '').trim()
  const rootDir = String(segments[0] || '').trim().toLowerCase()

  if (
    rootDir === 'skills'
    && parentDir
    && (fileName === 'skill.md' || fileName === 'description.md')
  ) {
    return parentDir
  }

  return segments[segments.length - 1] || normalized
}

function isToolMessageExpanded(messageId) {
  const normalizedMessageId = String(messageId || '').trim()

  if (!normalizedMessageId) {
    return false
  }

  if (normalizedMessageId.startsWith('tool-progress-') && !(normalizedMessageId in expandedToolMessages.value)) {
    return true
  }

  return Boolean(expandedToolMessages.value[normalizedMessageId])
}

function toggleToolMessage(messageId) {
  const normalizedMessageId = String(messageId || '').trim()

  if (!normalizedMessageId) {
    return
  }

  expandedToolMessages.value = {
    ...expandedToolMessages.value,
    [normalizedMessageId]: !expandedToolMessages.value[normalizedMessageId]
  }
}

function getMostRecentWorkspaceFile(files) {
  if (!Array.isArray(files) || !files.length) {
    return null
  }

  return [...files]
    .filter((item) => String(item?.path || '').trim())
    .sort((left, right) => (
      String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || ''))
    ))[0] || null
}

function resetWorkspaceFileCopyState() {
  hasCopiedWorkspaceFile.value = false
  isCopyingWorkspaceFile.value = false

  if (workspaceFileCopyResetTimer) {
    clearTimeout(workspaceFileCopyResetTimer)
    workspaceFileCopyResetTimer = null
  }
}

async function copyWorkspaceFileContent() {
  const content = String(normalizedWorkspaceFileContent.value || '')

  if (!content || isCopyingWorkspaceFile.value) {
    return
  }

  isCopyingWorkspaceFile.value = true

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(content)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = content
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'absolute'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    hasCopiedWorkspaceFile.value = true
  } finally {
    isCopyingWorkspaceFile.value = false

    if (workspaceFileCopyResetTimer) {
      clearTimeout(workspaceFileCopyResetTimer)
    }

    workspaceFileCopyResetTimer = setTimeout(() => {
      hasCopiedWorkspaceFile.value = false
      workspaceFileCopyResetTimer = null
    }, 1600)
  }
}

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

function openAttachmentPicker() {
  attachmentInputRef.value?.click()
}

function handleAttachmentInputChange(event) {
  const files = Array.from(event?.target?.files || [])

  if (files.length) {
    emit('upload-attachments', files)
  }

  if (event?.target) {
    event.target.value = ''
  }
}

function requestSend() {
  if (!props.canSend || props.isSending) {
    return
  }

  shouldRestoreFocus.value = true
  emit('send')
}

function toggleInspectorCollapsed() {
  isInspectorCollapsed.value = !isInspectorCollapsed.value
}

function stopPreviewResize() {
  isResizingPreview.value = false
  activeResizePointerId = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function updatePreviewWidthFromClientX(clientX) {
  const shellElement = shellRef.value

  if (!shellElement) {
    return
  }

  const rect = shellElement.getBoundingClientRect()
  const inspectorWidth = isInspectorCollapsed.value ? 24 : 308
  const horizontalGutters = 36
  const minPreviewWidth = 320
  const maxPreviewWidth = Math.max(minPreviewWidth, rect.width - 280 - inspectorWidth - horizontalGutters - 280)
  const nextWidth = rect.right - inspectorWidth - horizontalGutters - clientX

  previewWidth.value = Math.min(maxPreviewWidth, Math.max(minPreviewWidth, Math.round(nextWidth)))
}

function handlePreviewResizeMove(event) {
  if (!isResizingPreview.value) {
    return
  }

  updatePreviewWidthFromClientX(event.clientX)
}

function handlePreviewResizeUp(event) {
  if (activeResizePointerId !== null && event.pointerId !== activeResizePointerId) {
    return
  }

  stopPreviewResize()
}

function startPreviewResize(event) {
  if (!hasWorkspaceFilePreview.value) {
    return
  }

  activeResizePointerId = event.pointerId
  isResizingPreview.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  updatePreviewWidthFromClientX(event.clientX)
}

function handleComposerKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return
  }

  event.preventDefault()
  requestSend()
}

function handleWorkspaceFileClick(filePath) {
  const normalizedPath = String(filePath || '').trim()
  const selectedPath = String(props.selectedWorkspaceFilePath || '').trim()

  if (normalizedPath && normalizedPath === selectedPath && hasWorkspaceFilePreview.value) {
    emit('close-workspace-file')
    return
  }

  emit('open-workspace-file', normalizedPath)
}

watch(
  () => props.isLoadingSession,
  (loading) => {
    if (suppressAutoOpenTimer) {
      clearTimeout(suppressAutoOpenTimer)
      suppressAutoOpenTimer = null
    }

    if (loading) {
      suppressAutoOpen.value = true
    } else {
      suppressAutoOpenTimer = setTimeout(() => {
        suppressAutoOpen.value = false
        suppressAutoOpenTimer = null
      }, 500)
    }
  },
  { immediate: true }
)

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

// 监听最新消息，检测文件操作是否完成
watch(
  () => props.messages[props.messages.length - 1],
  (latestMessage) => {
    if (!latestMessage || latestMessage.role !== 'tool' || suppressAutoOpen.value) {
      return
    }

    const content = String(latestMessage.content || '').toLowerCase()

    if ((content.includes('工具：write_file') || content.includes('工具：apply_patch')) && content.includes('目标：')) {
      const pathMatch = content.match(/目标：([^\n]+)/i)

      if (pathMatch?.[1]) {
        const filePath = pathMatch[1].trim()

        setTimeout(() => {
          emit('open-workspace-file', filePath)
        }, 800)
      }
    }
  },
  { deep: true }
)

watch(
  () => props.activeSessionId,
  () => {
    hasInitializedWorkspaceFilesForSession.value = false
  },
  { immediate: true }
)

watch(
  () => props.activeWorkspaceFiles.map((item) => `${item.path || ''}:${item.updatedAt || ''}`).join('|'),
  (nextSignature, previousSignature) => {
    if (!nextSignature || nextSignature === previousSignature || suppressAutoOpen.value) {
      return
    }

    if (!hasInitializedWorkspaceFilesForSession.value) {
      hasInitializedWorkspaceFilesForSession.value = true
      return
    }

    const latestFile = getMostRecentWorkspaceFile(props.activeWorkspaceFiles)

    if (!latestFile?.path) {
      return
    }

    const selectedPath = String(props.selectedWorkspaceFilePath || '').trim()
    const selectedUpdatedAt = String(props.selectedWorkspaceFileUpdatedAt || '').trim()
    const latestUpdatedAt = String(latestFile.updatedAt || '').trim()
    const shouldOpenLatestFile = !selectedPath
      || selectedPath !== latestFile.path
      || (latestUpdatedAt && latestUpdatedAt !== selectedUpdatedAt)

    if (!shouldOpenLatestFile) {
      return
    }

    setTimeout(() => {
      emit('open-workspace-file', latestFile.path)
    }, 300)
  }
)

watch(
  hasWorkspaceFilePreview,
  (visible) => {
    if (!visible && isResizingPreview.value) {
      stopPreviewResize()
    }
  }
)

watch(
  () => props.embeddingConfigs,
  (items) => {
    if (
      props.selectedEmbeddingAiId
      && !items.some((item) => item.aiId === props.selectedEmbeddingAiId)
    ) {
      emit('update:embedding-ai-id', '')
    }
  },
  { deep: true }
)

watch(
  [normalizedWorkspaceFileContent, selectedWorkspaceLanguage, hasWorkspaceFilePreview],
  async () => {
    await nextTick()
    scheduleWorkspaceFileHighlight()
  },
  { immediate: true }
)

if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', handlePreviewResizeMove)
  window.addEventListener('pointerup', handlePreviewResizeUp)
  window.addEventListener('pointercancel', handlePreviewResizeUp)
}

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointermove', handlePreviewResizeMove)
    window.removeEventListener('pointerup', handlePreviewResizeUp)
    window.removeEventListener('pointercancel', handlePreviewResizeUp)
  }

  if (suppressAutoOpenTimer) {
    clearTimeout(suppressAutoOpenTimer)
    suppressAutoOpenTimer = null
  }

  if (conversationCopyToastTimer) {
    clearTimeout(conversationCopyToastTimer)
    conversationCopyToastTimer = null
  }

  cancelWorkspaceFileHighlightSchedule()
  resetWorkspaceFileCopyState()
  stopPreviewResize()
})
</script>

<style scoped>
.agent-shell {
  --agent-content-width: 880px;
  --agent-preview-width: 520px;
  --agent-inspector-width: 308px;
  --agent-text: #171717;
  --agent-subtle: #6f6f6f;
  --agent-muted: #8a8a8a;
  --agent-border: #ececec;
  --agent-border-strong: #dedede;
  --agent-surface: #ffffff;
  --agent-sidebar-surface: #f7f7f8;
  --agent-soft-surface: #f4f4f4;
  --agent-soft-surface-hover: #eeeeee;
  --agent-soft-surface-active: #e7e7e7;
  --agent-focus: rgba(23, 23, 23, 0.14);
  position: relative;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 0 minmax(0, 0) var(--agent-inspector-width);
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--agent-surface);
  color: var(--agent-text);
  transition: grid-template-columns 0.48s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-copy-toast {
  position: absolute;
  left: 50%;
  top: 20px;
  z-index: 40;
  transform: translateX(-50%);
  min-width: 128px;
  padding: 12px 18px;
  border: 1px solid rgba(34, 197, 94, 0.22);
  border-radius: 14px;
  background: #ecfdf3;
  color: #15803d;
  box-shadow: 0 14px 34px rgba(34, 197, 94, 0.16);
  font-size: 0.9rem;
  font-weight: 800;
  text-align: center;
  pointer-events: none;
}

.agent-copy-toast-enter-active,
.agent-copy-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.agent-copy-toast-enter-from,
.agent-copy-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px) scale(0.96);
}

@keyframes agent-nav-active-pop {
  0% {
    opacity: 0.72;
    transform: translateX(-6px) scale(0.985);
  }

  100% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes agent-panel-switch-in {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }

  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.agent-shell.is-resizing-preview {
  transition: none;
}

.agent-shell.has-file-preview {
  grid-template-columns: 280px minmax(0, 1fr) 14px minmax(320px, var(--agent-preview-width)) var(--agent-inspector-width);
}

.agent-shell.is-sidebar-hidden {
  grid-template-columns: minmax(0, 1fr) 0 minmax(0, 0) var(--agent-inspector-width);
}

.agent-shell.is-sidebar-hidden.has-file-preview {
  grid-template-columns: minmax(0, 1fr) 14px minmax(320px, var(--agent-preview-width)) var(--agent-inspector-width);
}

.agent-shell__sidebar,
.agent-shell__main,
.agent-shell__inspector,
.agent-shell__preview,
.agent-shell__resizer {
  min-height: 0;
}

.agent-shell__sidebar {
  order: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow: hidden;
  background: var(--agent-sidebar-surface);
  border-right: 1px solid var(--agent-border);
}

.agent-sidebar__lower {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
}

.agent-shell__main {
  order: 2;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  position: relative;
  min-width: 0;
  overflow: hidden;
  background: var(--agent-surface);
}

.agent-shell__inspector {
  order: 5;
  position: relative;
  z-index: 3;
  padding: 18px 18px 18px 0;
  background: var(--agent-surface);
  border-left: 1px solid var(--agent-border);
  overflow: visible;
  transition:
    padding 0.48s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.24s ease;
}

.agent-shell__inspector.is-collapsed {
  padding: 18px 0 18px 0;
}

.agent-inspector__panel {
  height: 100%;
  overflow: hidden;
  opacity: 1;
  transform: translateX(0);
  transform-origin: right center;
  transition:
    opacity 0.42s ease,
    transform 0.48s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform;
}

.agent-inspector__panel.is-hidden {
  opacity: 0;
  transform: translateX(44px);
  pointer-events: none;
}

.agent-skill-picker {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 36px;
  background: rgba(255, 255, 255, 0.42);
  backdrop-filter: blur(6px);
}

.agent-skill-picker__panel {
  width: min(1120px, calc(100% - 56px));
  height: min(760px, calc(100% - 64px));
  max-height: min(820px, calc(100% - 64px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 22px;
  padding: 26px;
  border: 1px solid rgba(225, 229, 236, 0.92);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.14);
}

.agent-session-extra {
  min-height: 0;
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--agent-border);
  border-radius: 22px;
  background: #ffffff;
}

.agent-session-extra__nav {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 14px;
  overflow: auto;
  border-right: 1px solid var(--agent-border);
  background: #f8fafc;
}

.agent-session-extra__nav-item {
  position: relative;
  overflow: hidden;
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: var(--agent-text);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition:
    background-color 0.24s ease,
    border-color 0.24s ease,
    color 0.24s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.24s ease;
}

.agent-session-extra__nav-item:hover {
  background: #ffffff;
  border-color: #e5eaf4;
  transform: translateX(2px);
}

.agent-session-extra__nav-item.is-active {
  background: #111111;
  border-color: #111111;
  color: #ffffff;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.16);
  animation: agent-nav-active-pop 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-session-extra__nav-item strong,
.agent-session-extra__nav-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-session-extra__nav-item strong {
  font-size: 0.9rem;
  font-weight: 850;
}

.agent-session-extra__nav-item span {
  color: currentColor;
  opacity: 0.72;
  font-size: 0.76rem;
}

.agent-session-extra__content {
  min-height: 0;
  overflow: auto;
  padding: 22px;
}

.agent-session-extra__section {
  min-width: 0;
  min-height: 100%;
  display: grid;
  align-content: start;
  gap: 18px;
  animation: agent-panel-switch-in 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-session-extra__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.agent-session-extra__section-head p,
.agent-session-extra__section-head small {
  margin: 0;
}

.agent-session-extra__section-head p {
  color: var(--agent-text);
  font-size: 0.94rem;
  font-weight: 850;
}

.agent-session-extra__section-head small,
.agent-session-extra__hint {
  color: var(--agent-subtle);
  font-size: 0.78rem;
  line-height: 1.55;
}

.agent-session-extra__section-head > span,
.agent-session-extra__section-head > button {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid #e4e8ef;
  border-radius: 999px;
  background: #f8fafc;
  color: #3f4654;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
}

.agent-session-extra__section-head > button {
  cursor: pointer;
}

.agent-session-extra__section-head > button:hover:not(:disabled) {
  background: #eef3ff;
  border-color: #d4defc;
  color: #264db7;
}

.agent-session-extra__select {
  width: 100%;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--agent-border-strong);
  border-radius: 12px;
  background: #fbfbfc;
  color: var(--agent-text);
  font: inherit;
  outline: none;
}

.agent-session-extra__select:focus {
  border-color: #9bb4ff;
  box-shadow: 0 0 0 4px rgba(155, 180, 255, 0.18);
}

.agent-skill-picker__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.agent-skill-picker__head h3,
.agent-skill-picker__head p,
.agent-skill-picker__head small {
  margin: 0;
}

.agent-skill-picker__head h3 {
  margin-top: 6px;
  color: var(--agent-text);
  font-size: 1.1rem;
}

.agent-skill-picker__head small {
  display: block;
  margin-top: 8px;
  color: var(--agent-subtle);
  font-size: 0.84rem;
  line-height: 1.6;
}

.agent-skill-picker__close {
  width: 34px;
  height: 34px;
  border: 1px solid #e4e8ef;
  border-radius: 10px;
  background: #f8fafc;
  color: #444444;
  cursor: pointer;
  font: inherit;
  font-size: 1.15rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}

.agent-skill-picker__close:hover {
  background: #eef3ff;
  border-color: #d4defc;
  color: #264db7;
}

.agent-skill-picker__list {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  align-content: start;
  overflow: auto;
  padding-right: 4px;
}

.agent-skill-option {
  width: 100%;
  min-height: 58px;
  display: grid;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--agent-border);
  border-radius: 14px;
  background: #ffffff;
  color: inherit;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.agent-skill-option:hover {
  background: #f8fbff;
  border-color: #d7def7;
  box-shadow: 0 10px 24px rgba(38, 77, 183, 0.08);
  transform: translateY(-1px);
}

.agent-skill-option.is-active {
  border-color: #111111;
  background: #111111;
  color: #ffffff;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.18);
}

.agent-skill-option.is-disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.agent-skill-option strong {
  margin: 0;
  color: currentColor;
  font-size: 0.92rem;
  line-height: 1.25;
}

.agent-skill-option small {
  color: currentColor;
  font-size: 0.76rem;
  line-height: 1.35;
  opacity: 0.66;
}

.skill-picker-fade-enter-active,
.skill-picker-fade-leave-active {
  transition: opacity 0.45s ease;
}

.skill-picker-fade-enter-active .agent-skill-picker__panel,
.skill-picker-fade-leave-active .agent-skill-picker__panel {
  transition:
    opacity 0.45s ease,
    transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.skill-picker-fade-enter-from,
.skill-picker-fade-leave-to {
  opacity: 0;
}

.skill-picker-fade-enter-from .agent-skill-picker__panel,
.skill-picker-fade-leave-to .agent-skill-picker__panel {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
}

.agent-inspector__toggle {
  position: absolute;
  top: 50%;
  left: 0;
  z-index: 8;
  width: 28px;
  height: 56px;
  transform: translate(-50%, -50%);
  border: 1px solid var(--agent-border);
  border-radius: 999px;
  background: #ffffff;
  color: #5f5f5f;
  cursor: pointer;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
  transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.agent-inspector__toggle:hover {
  background: #f6f7fb;
  color: #2f4fa8;
  border-color: #d7def7;
}

.agent-inspector__toggle:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 4px var(--agent-focus);
}

.agent-shell__resizer {
  order: 3;
  position: relative;
  z-index: 1;
  cursor: col-resize;
  background: transparent;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.28s ease;
}

.agent-shell__resizer.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.agent-shell__resizer::before {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: #d7d7d7;
  transition: background-color 0.18s ease;
}

.agent-shell__resizer:hover::before,
.agent-shell.is-resizing-preview .agent-shell__resizer::before {
  background: #8ea9ff;
}

.agent-shell__preview {
  order: 4;
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  padding: 18px 18px 18px 0;
  background: var(--agent-surface);
  overflow: hidden;
  opacity: 0;
  transform: translateX(36px);
  pointer-events: none;
  will-change: transform, opacity;
  transition:
    opacity 0.42s ease,
    transform 0.48s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-shell__preview.is-visible {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
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
  color: var(--agent-text);
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.2;
}

.agent-sidebar__brand small {
  max-width: 164px;
  margin-top: 2px;
  color: var(--agent-subtle);
  font-size: 0.78rem;
}

.agent-user-card__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--agent-text);
  color: #ffffff;
  font-size: 0.8rem;
  font-weight: 700;
}

.agent-sidebar__icon-button,
.agent-sidebar__new-chat,
.agent-session-item__main,
.agent-session-item__delete,
.agent-sidebar__logout,
.agent-starter-card,
.agent-composer__send,
.agent-composer__stop,
.agent-info-card__config-button {
  border: 0;
  font: inherit;
}

.agent-sidebar__icon-button,
.agent-sidebar__new-chat,
.agent-session-item__main,
.agent-session-item__delete,
.agent-sidebar__logout,
.agent-starter-card,
.agent-composer__send,
.agent-composer__stop,
.agent-info-card__config-button {
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    opacity 150ms ease,
    transform 150ms ease;
}

.agent-sidebar__icon-button:focus-visible,
.agent-sidebar__new-chat:focus-visible,
.agent-session-item__main:focus-visible,
.agent-session-item__delete:focus-visible,
.agent-sidebar__logout:focus-visible,
.agent-starter-card:focus-visible,
.agent-composer__send:focus-visible,
.agent-composer__stop:focus-visible,
.agent-info-card__config-button:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 4px var(--agent-focus);
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
  font-size: 1.2rem;
  line-height: 1;
}

.agent-sidebar__icon-button svg {
  width: 18px;
  height: 18px;
}

.agent-sidebar__icon-button:hover,
.agent-sidebar__new-chat:hover,
.agent-sidebar__logout:hover {
  background: var(--agent-border);
}

.agent-sidebar__icon-button:disabled,
.agent-sidebar__new-chat:disabled {
  opacity: 0.52;
  cursor: not-allowed;
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
  flex-direction: column;
  min-height: 0;
  flex: 1;
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
  padding-right: 0;
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
  border: 0;
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
  padding: 0;
  border-radius: 10px;
  background: transparent;
  transition:
    background-color 0.24s ease,
    box-shadow 0.24s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-session-item.is-active {
  background: #e7e7e7;
  animation: agent-nav-active-pop 0.34s cubic-bezier(0.22, 1, 0.36, 1);
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

.agent-session-item__main:hover {
  background: #eeeeee;
  transform: translateX(2px);
}

.agent-session-item__title {
  display: block;
  overflow: hidden;
  color: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.93rem;
  font-weight: 400;
  line-height: 1.35;
}

.agent-session-item__delete {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  justify-self: center;
  border-radius: 8px;
  background: transparent;
  color: #777777;
  cursor: pointer;
  font-size: 0.9rem;
  opacity: 0;
  pointer-events: none;
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
  width: 100%;
  min-height: 40px;
  padding: 9px 10px;
  border-radius: 10px;
  background: transparent;
  color: #4a4a4a;
  cursor: pointer;
  text-align: left;
  font-size: 0.92rem;
}

.agent-mainbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 68px;
  padding: 0 24px;
  border-bottom: 1px solid var(--agent-border);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
}

.agent-mainbar__copy {
  min-width: 0;
}

.agent-mainbar__actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.agent-mainbar__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--agent-subtle);
  font-size: 0.78rem;
  font-weight: 650;
}

.agent-mainbar__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #35b36b;
  box-shadow: 0 0 0 5px rgba(53, 179, 107, 0.14);
}

.agent-mainbar__copy h2 {
  margin: 8px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.1rem;
  font-weight: 700;
}

.agent-token-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(147, 114, 255, 0.12);
  color: #7c5fe4;
  font-size: 0.82rem;
  font-weight: 700;
}

.agent-context-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  min-width: 58px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(14, 165, 233, 0.14);
  color: #0369a1;
  font-size: 0.82rem;
  font-weight: 700;
}

.agent-task-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 700;
}

.agent-mode-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 700;
}

.agent-mode-badge.is-chat {
  background: #f2f2f2;
  color: #565656;
}

.agent-mode-badge.is-coding {
  background: rgba(53, 179, 107, 0.14);
  color: #227a48;
}

.agent-task-badge.is-idle {
  background: #f2f2f2;
  color: #565656;
}

.agent-task-badge.is-running {
  background: rgba(61, 118, 255, 0.12);
  color: #244fb4;
}

.agent-task-badge.is-completed {
  background: rgba(53, 179, 107, 0.14);
  color: #227a48;
}

.agent-task-badge.is-danger {
  background: rgba(209, 76, 62, 0.12);
  color: #a6382c;
}

.agent-conversation {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
  background:
    radial-gradient(circle at top, rgba(0, 0, 0, 0.035), transparent 32%),
    linear-gradient(180deg, #ffffff 0%, #fdfdfd 100%);
}

.agent-conversation__status {
  position: absolute;
  z-index: 3;
  top: 20px;
  left: 24px;
  right: 24px;
}

.agent-conversation__messages {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 26px;
  overflow-y: auto;
  padding:
    34px
    max(24px, calc((100% - var(--agent-content-width)) / 2))
    18px;
}

.agent-conversation__welcome {
  display: grid;
  gap: 30px;
  align-content: center;
  min-height: 100%;
  width: min(100%, var(--agent-content-width));
  padding: 36px 0;
  justify-self: center;
}

.agent-conversation__welcome-copy {
  display: grid;
  gap: 12px;
  justify-items: center;
  text-align: center;
}

.agent-conversation__welcome-tag {
  margin: 0;
  color: var(--agent-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.agent-conversation__welcome-copy h3 {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.5rem);
  line-height: 1.1;
}

.agent-conversation__welcome-copy p:last-child {
  max-width: 720px;
  margin: 0;
  color: var(--agent-subtle);
  line-height: 1.8;
}

.agent-conversation__auto-refresh-hint {
  color: #5f8758 !important;
  font-weight: 500;
}

.agent-conversation__starter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.agent-starter-card {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid var(--agent-border);
  border-radius: 18px;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
}

.agent-starter-card:hover {
  background: #f7f7f7;
  border-color: #d9d9d9;
  transform: translateY(-1px);
}

.agent-starter-card strong,
.agent-starter-card span {
  display: block;
}

.agent-starter-card strong {
  color: var(--agent-text);
  font-size: 1rem;
}

.agent-starter-card span {
  color: var(--agent-subtle);
  font-size: 0.86rem;
  line-height: 1.65;
}

.agent-message {
  display: grid;
  gap: 6px;
  max-width: 100%;
}

.agent-message--user {
  width: min(100%, var(--agent-content-width));
  justify-self: center;
  justify-items: end;
}

.agent-message--assistant,
.agent-message--tool,
.agent-message--progress {
  width: min(100%, var(--agent-content-width));
  justify-self: center;
}

.agent-message__role {
  color: var(--agent-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.agent-message__bubble {
  border: 0;
  box-shadow: none;
}

.agent-message--assistant .agent-message__bubble {
  padding: 2px 0;
  background: transparent;
}

.agent-message--progress .agent-message__bubble {
  padding: 0;
  background: transparent;
}

.agent-message--tool .agent-message__bubble {
  padding: 0;
  background: transparent;
}

.agent-message--user .agent-message__bubble {
  padding: 12px 16px;
  border-radius: 22px;
  background: var(--agent-soft-surface);
}

.agent-message__bubble p {
  margin: 0;
  color: var(--agent-text);
  line-height: 1.75;
  white-space: pre-wrap;
}

.agent-message__actions {
  min-height: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.agent-message:hover .agent-message__actions,
.agent-message:focus-within .agent-message__actions {
  opacity: 1;
  transform: translateY(0);
}

.agent-message--user .agent-message__actions {
  justify-content: flex-end;
}

.agent-message--assistant .agent-message__actions {
  justify-content: flex-start;
}

.agent-message__copy {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: #6f6f6f;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}

.agent-message__copy:hover:not(:disabled) {
  background: #f4f4f4;
  border-color: #e6e6e6;
  color: #171717;
}

.agent-message__copy:disabled {
  cursor: wait;
  opacity: 0.6;
}

.agent-message__copy svg {
  width: 16px;
  height: 16px;
}

.agent-markdown-content {
  color: var(--agent-text);
  line-height: 1.75;
}

.agent-markdown-content > :first-child {
  margin-top: 0;
}

.agent-markdown-content > :last-child {
  margin-bottom: 0;
}

.agent-markdown-content h1,
.agent-markdown-content h2,
.agent-markdown-content h3,
.agent-markdown-content h4,
.agent-markdown-content h5,
.agent-markdown-content h6 {
  margin: 0 0 0.8rem;
  color: #121926;
  font-weight: 800;
  line-height: 1.35;
}

.agent-markdown-content h1 {
  font-size: 1.75rem;
}

.agent-markdown-content h2 {
  font-size: 1.45rem;
}

.agent-markdown-content h3 {
  font-size: 1.2rem;
}

.agent-markdown-content p {
  margin: 0 0 0.9rem;
  white-space: normal;
}

.agent-markdown-content strong {
  font-weight: 800;
}

.agent-markdown-content em {
  font-style: italic;
}

.agent-markdown-content ul,
.agent-markdown-content ol {
  margin: 0 0 1rem;
  padding-left: 1.45rem;
}

.agent-markdown-content li + li {
  margin-top: 0.4rem;
}

.agent-markdown-content code {
  display: inline;
  padding: 0.12rem 0.38rem;
  border-radius: 0.45rem;
  background: rgba(99, 102, 241, 0.08);
  color: #334155;
  font-size: 0.92em;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.agent-markdown-content a {
  color: #315ddb;
  text-decoration: none;
}

.agent-markdown-content a:hover {
  text-decoration: underline;
}

.agent-progress-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 14px 16px;
  border: 1px solid #dfe7fb;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(247, 250, 255, 0.98), rgba(241, 246, 255, 0.98));
  box-shadow: 0 10px 24px rgba(88, 116, 188, 0.08);
}

.agent-progress-card__dot {
  width: 10px;
  height: 10px;
  margin-top: 0.38rem;
  border-radius: 999px;
  background: #4f7cff;
  box-shadow: 0 0 0 6px rgba(79, 124, 255, 0.12);
  animation: agent-progress-pulse 1.35s ease-in-out infinite;
}

.agent-progress-card__copy {
  min-width: 0;
}

.agent-progress-card__copy strong {
  display: block;
  margin: 0 0 4px;
  color: #2950b8;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.agent-progress-card__copy p {
  color: #25324f;
  line-height: 1.6;
}

.agent-tool-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 14px 16px;
  border: 1px solid #e3e7ef;
  border-radius: 16px;
  background: linear-gradient(180deg, #fbfcfe, #f6f8fb);
  box-shadow: 0 8px 20px rgba(60, 72, 95, 0.06);
}

.agent-tool-card__rail {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding-top: 4px;
}

.agent-tool-card__dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #6b7280;
  box-shadow: 0 0 0 6px rgba(107, 114, 128, 0.12);
}

.agent-tool-card__line {
  width: 2px;
  min-height: 44px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(107, 114, 128, 0.45), rgba(107, 114, 128, 0));
}

.agent-tool-card__copy {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.agent-tool-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.agent-tool-card__head strong {
  color: #374151;
  font-size: 0.85rem;
  font-weight: 700;
}

.agent-tool-card__toggle {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #5f6b7d;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.agent-tool-card__toggle:hover {
  color: #1f2937;
}

.agent-tool-card__toggle-icon {
  display: inline-block;
  font-size: 0.85rem;
  line-height: 1;
  transition: transform 160ms ease;
}

.agent-tool-card__toggle-icon.is-expanded {
  transform: rotate(180deg);
}

.agent-tool-card__name {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: #e8edf6;
  color: #2f4b78;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.agent-tool-card__icon {
  font-size: 0.95rem;
  line-height: 1;
}

.agent-tool-card__status {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(34, 122, 72, 0.1);
  color: #227a48;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.agent-tool-card__status.is-failed {
  background: rgba(214, 76, 76, 0.12);
  color: #b83434;
}

.agent-tool-card__status.is-running {
  background: rgba(59, 95, 189, 0.12);
  color: #3558b8;
}

.agent-tool-card__meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.agent-tool-card__meta,
.agent-tool-card__result {
  margin: 0;
  white-space: pre-wrap;
}

.agent-tool-card__meta {
  color: #5f6b7d;
  font-size: 0.82rem;
  line-height: 1.6;
}

.agent-tool-card__meta--duration {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(95, 107, 125, 0.08);
  color: #4f5b6a;
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1;
}

.agent-tool-card__result {
  color: #1f2937;
  line-height: 1.7;
}

.agent-tool-card__body {
  padding-top: 4px;
  border-top: 1px solid rgba(95, 107, 125, 0.12);
}

.agent-tool-card.is-status-failed {
  border-color: #f3d1d1;
  background: linear-gradient(180deg, #fff9f9, #fff3f3);
}

.agent-tool-card.is-status-failed .agent-tool-card__dot {
  background: #d64c4c;
  box-shadow: 0 0 0 6px rgba(214, 76, 76, 0.12);
}

.agent-tool-card.is-status-failed .agent-tool-card__line {
  background: linear-gradient(180deg, rgba(214, 76, 76, 0.42), rgba(214, 76, 76, 0));
}

.agent-tool-card.is-read {
  border-color: #d8e4ff;
  background: linear-gradient(180deg, #f9fbff, #f2f7ff);
}

.agent-tool-card.is-read .agent-tool-card__dot {
  background: #4f7cff;
  box-shadow: 0 0 0 6px rgba(79, 124, 255, 0.12);
}

.agent-tool-card.is-read .agent-tool-card__line {
  background: linear-gradient(180deg, rgba(79, 124, 255, 0.42), rgba(79, 124, 255, 0));
}

.agent-tool-card.is-read .agent-tool-card__name {
  background: #e8f0ff;
  color: #2950b8;
}

.agent-tool-card.is-browse,
.agent-tool-card.is-search {
  border-color: #d7ecff;
  background: linear-gradient(180deg, #fbfdff, #f3faff);
}

.agent-tool-card.is-browse .agent-tool-card__dot,
.agent-tool-card.is-search .agent-tool-card__dot {
  background: #1692c5;
  box-shadow: 0 0 0 6px rgba(22, 146, 197, 0.12);
}

.agent-tool-card.is-browse .agent-tool-card__line,
.agent-tool-card.is-search .agent-tool-card__line {
  background: linear-gradient(180deg, rgba(22, 146, 197, 0.42), rgba(22, 146, 197, 0));
}

.agent-tool-card.is-browse .agent-tool-card__name,
.agent-tool-card.is-search .agent-tool-card__name {
  background: #e9f8ff;
  color: #0f6f96;
}

.agent-tool-card.is-command {
  border-color: #ece2ff;
  background: linear-gradient(180deg, #fcfbff, #f7f4ff);
}

.agent-tool-card.is-command .agent-tool-card__dot {
  background: #7c5fe4;
  box-shadow: 0 0 0 6px rgba(124, 95, 228, 0.12);
}

.agent-tool-card.is-command .agent-tool-card__line {
  background: linear-gradient(180deg, rgba(124, 95, 228, 0.4), rgba(124, 95, 228, 0));
}

.agent-tool-card.is-command .agent-tool-card__name {
  background: #efe8ff;
  color: #694bcf;
}

.agent-tool-card.is-write,
.agent-tool-card.is-patch {
  border-color: #d9efdf;
  background: linear-gradient(180deg, #fbfefb, #f3faf4);
}

.agent-tool-card.is-write .agent-tool-card__dot,
.agent-tool-card.is-patch .agent-tool-card__dot {
  background: #35b36b;
  box-shadow: 0 0 0 6px rgba(53, 179, 107, 0.12);
}

.agent-tool-card.is-write .agent-tool-card__line,
.agent-tool-card.is-patch .agent-tool-card__line {
  background: linear-gradient(180deg, rgba(53, 179, 107, 0.42), rgba(53, 179, 107, 0));
}

.agent-tool-card.is-write .agent-tool-card__name,
.agent-tool-card.is-patch .agent-tool-card__name {
  background: #eaf7ee;
  color: #227a48;
}

.agent-tool-card.is-skill {
  border-color: #efdfb6;
  background: linear-gradient(180deg, #fffdf8, #faf6eb);
}

.agent-tool-card.is-skill .agent-tool-card__dot {
  background: #c89a33;
  box-shadow: 0 0 0 6px rgba(200, 154, 51, 0.12);
}

.agent-tool-card.is-skill .agent-tool-card__line {
  background: linear-gradient(180deg, rgba(200, 154, 51, 0.42), rgba(200, 154, 51, 0));
}

.agent-tool-card.is-skill .agent-tool-card__name {
  background: #faefcf;
  color: #8a6613;
}

.agent-tool-card.is-status-failed,
.agent-tool-card.is-status-failed.is-read,
.agent-tool-card.is-status-failed.is-browse,
.agent-tool-card.is-status-failed.is-search,
.agent-tool-card.is-status-failed.is-command,
.agent-tool-card.is-status-failed.is-write,
.agent-tool-card.is-status-failed.is-patch,
.agent-tool-card.is-status-failed.is-skill {
  border-color: #f3d1d1;
  background: linear-gradient(180deg, #fff9f9, #fff3f3);
}

.agent-tool-card.is-status-failed .agent-tool-card__dot,
.agent-tool-card.is-status-failed.is-read .agent-tool-card__dot,
.agent-tool-card.is-status-failed.is-browse .agent-tool-card__dot,
.agent-tool-card.is-status-failed.is-search .agent-tool-card__dot,
.agent-tool-card.is-status-failed.is-command .agent-tool-card__dot,
.agent-tool-card.is-status-failed.is-write .agent-tool-card__dot,
.agent-tool-card.is-status-failed.is-patch .agent-tool-card__dot,
.agent-tool-card.is-status-failed.is-skill .agent-tool-card__dot {
  background: #d64c4c;
  box-shadow: 0 0 0 6px rgba(214, 76, 76, 0.12);
}

.agent-tool-card.is-status-failed .agent-tool-card__line,
.agent-tool-card.is-status-failed.is-read .agent-tool-card__line,
.agent-tool-card.is-status-failed.is-browse .agent-tool-card__line,
.agent-tool-card.is-status-failed.is-search .agent-tool-card__line,
.agent-tool-card.is-status-failed.is-command .agent-tool-card__line,
.agent-tool-card.is-status-failed.is-write .agent-tool-card__line,
.agent-tool-card.is-status-failed.is-patch .agent-tool-card__line,
.agent-tool-card.is-status-failed.is-skill .agent-tool-card__line {
  background: linear-gradient(180deg, rgba(214, 76, 76, 0.42), rgba(214, 76, 76, 0));
}

.agent-tool-card.is-status-failed .agent-tool-card__name,
.agent-tool-card.is-status-failed.is-read .agent-tool-card__name,
.agent-tool-card.is-status-failed.is-browse .agent-tool-card__name,
.agent-tool-card.is-status-failed.is-search .agent-tool-card__name,
.agent-tool-card.is-status-failed.is-command .agent-tool-card__name,
.agent-tool-card.is-status-failed.is-write .agent-tool-card__name,
.agent-tool-card.is-status-failed.is-patch .agent-tool-card__name,
.agent-tool-card.is-status-failed.is-skill .agent-tool-card__name {
  background: #fdeaea;
  color: #b83434;
}

.agent-lark-chat-list {
  width: min(100%, 780px);
  overflow: hidden;
  border: 1px solid rgba(23, 23, 23, 0.1);
  border-radius: 16px;
  background: #ffffff;
}

.agent-lark-chat-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  background: #ffffff;
}

.agent-lark-chat-table th,
.agent-lark-chat-table td {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(23, 23, 23, 0.08);
  text-align: left;
  vertical-align: middle;
}

.agent-lark-chat-table th {
  background: #ffffff;
  color: #777777;
  font-size: 0.78rem;
  font-weight: 800;
}

.agent-lark-chat-table th:first-child,
.agent-lark-chat-table td:first-child {
  width: 38%;
}

.agent-lark-chat-table__row {
  cursor: pointer;
  transition: background 150ms ease;
}

.agent-lark-chat-table__row:hover,
.agent-lark-chat-table__row:focus-visible,
.agent-lark-chat-table__row.is-selected {
  background: #eeeeee;
  outline: none;
}

.agent-lark-chat-table tbody tr:last-child td {
  border-bottom: 0;
}

.agent-lark-chat-table__name,
.agent-lark-chat-table__id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-lark-chat-table__name {
  color: var(--agent-text);
  font-size: 0.94rem;
  font-weight: 800;
}

.agent-lark-chat-table__id {
  color: #555555;
  font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.8rem;
}

.agent-lark-chat-list__empty {
  margin: 0;
  padding: 14px;
  color: var(--agent-subtle);
  font-size: 0.9rem;
  line-height: 1.7;
}

.agent-message.is-partial .agent-message__bubble p::after {
  content: '';
  display: inline-block;
  width: 0.55ch;
  height: 1.1em;
  margin-left: 0.16rem;
  vertical-align: -0.16em;
  border-radius: 999px;
  background: rgba(40, 40, 40, 0.5);
  animation: agent-caret-blink 0.9s steps(1) infinite;
}

.agent-conversation__sending {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 14px 16px;
  border-radius: 999px;
  background: var(--agent-soft-surface);
  justify-self: center;
}

@keyframes agent-progress-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.9;
  }

  50% {
    transform: scale(1.12);
    opacity: 1;
  }
}

@keyframes agent-caret-blink {
  0%,
  50% {
    opacity: 0.9;
  }

  50.01%,
  100% {
    opacity: 0;
  }
}

.agent-conversation__sending span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--agent-muted);
  animation: agent-thinking 1.1s ease-in-out infinite;
}

.agent-conversation__sending span:nth-child(2) {
  animation-delay: 0.15s;
}

.agent-conversation__sending span:nth-child(3) {
  animation-delay: 0.3s;
}

.agent-composer {
  position: relative;
  z-index: 2;
  width: min(calc(100% - 40px), 780px);
  min-height: 112px;
  display: grid;
  gap: 14px;
  margin: 0 auto 24px;
  padding: 14px 14px 12px;
  overflow: hidden;
  border: 1px solid var(--agent-border-strong);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 12px 34px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  backdrop-filter: blur(10px);
}

.agent-composer__attachment-input {
  display: none;
}

.agent-composer__input {
  width: 100%;
  min-height: 62px;
  max-height: 180px;
  border: 0;
  padding: 2px 4px;
  background: transparent;
  color: var(--agent-text);
  font: inherit;
  line-height: 1.72;
  resize: none;
  overflow-y: auto;
  outline: none;
}

.agent-composer__input::placeholder {
  color: #979797;
}

.agent-composer__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.agent-composer__attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  padding: 8px 10px 8px 12px;
  border: 1px solid rgba(23, 23, 23, 0.08);
  border-radius: 14px;
  background: #f7f7f8;
}

.agent-composer__attachment-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.agent-composer__attachment-copy strong,
.agent-composer__attachment-copy small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-composer__attachment-copy strong {
  color: var(--agent-text);
  font-size: 0.82rem;
  font-weight: 700;
}

.agent-composer__attachment-copy small {
  color: var(--agent-subtle);
  font-size: 0.74rem;
}

.agent-composer__attachment-remove {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #666666;
  cursor: pointer;
  line-height: 1;
}

.agent-composer__attachment-remove:hover {
  background: rgba(23, 23, 23, 0.08);
  color: #171717;
}

.agent-composer__actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.agent-composer__upload,
.agent-composer__send,
.agent-composer__stop {
  transition: transform 150ms ease, opacity 150ms ease, background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.agent-composer__upload {
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid var(--agent-border-strong);
  border-radius: 999px;
  background: #ffffff;
  color: #4f4f4f;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.agent-composer__upload svg {
  width: 16px;
  height: 16px;
}

.agent-composer__upload:hover:not(:disabled) {
  background: #f5f5f5;
  color: #171717;
}

.agent-composer__send {
  min-width: 82px;
  min-height: 38px;
  padding: 0 18px;
  border-radius: 999px;
  background: var(--agent-text);
  color: #ffffff;
  cursor: pointer;
  font-weight: 700;
}

.agent-composer__send:hover:not(:disabled),
.agent-composer__upload:hover:not(:disabled),
.agent-composer__stop:hover:not(:disabled) {
  transform: translateY(-1px);
}

.agent-composer__upload:disabled,
.agent-composer__send:disabled,
.agent-composer__stop:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}

.agent-composer__stop {
  min-width: 96px;
  min-height: 38px;
  padding: 0 18px;
  border: 1px solid rgba(209, 76, 62, 0.22);
  border-radius: 999px;
  background: rgba(209, 76, 62, 0.08);
  color: #a6382c;
  cursor: pointer;
  font-weight: 700;
}

.agent-skill-picker__panel--notice {
  max-width: 520px;
}

.agent-skill-picker__expired-list {
  display: grid;
  gap: 12px;
  color: var(--agent-text);
}

.agent-skill-picker__expired-list p {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
}

.agent-skill-picker__expired-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.agent-skill-picker__expired-chip {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: #f4f4f5;
  color: #171717;
  font-size: 0.84rem;
  font-weight: 600;
}

.agent-skill-picker__footer {
  display: flex;
  justify-content: flex-end;
}

.agent-skill-picker__confirm {
  min-width: 96px;
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: #171717;
  color: #ffffff;
  font-weight: 700;
  cursor: pointer;
}

.agent-panel {
  display: grid;
  gap: 18px;
  align-content: start;
  height: 100%;
  padding: 22px 20px;
  border-radius: 24px;
  background: #fafafa;
}

.agent-panel__head,
.agent-panel__head h3,
.agent-panel__head p,
.agent-info-card__label,
.agent-info-card__value,
.agent-info-card__meta {
  margin: 0;
}

.agent-panel__eyebrow {
  color: var(--agent-muted);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.agent-panel__head h3 {
  margin-top: 6px;
  color: var(--agent-text);
  font-size: 1.05rem;
}

.agent-panel__stack {
  display: grid;
  gap: 14px;
}

.agent-info-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--agent-border);
  border-radius: 18px;
  background: #ffffff;
}

.agent-info-card--model-config {
  gap: 14px;
}

.agent-info-card__field {
  display: grid;
  gap: 8px;
}

.agent-info-card__label {
  color: var(--agent-muted);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.agent-info-card__value {
  color: var(--agent-text);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.5;
  word-break: break-word;
}

.agent-info-card__select {
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--agent-border-strong);
  border-radius: 14px;
  background: #ffffff;
  color: var(--agent-text);
  font: inherit;
  font-size: 0.92rem;
  line-height: 1.4;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.agent-info-card__select:focus {
  border-color: #b9b9b9;
  box-shadow: 0 0 0 4px var(--agent-focus);
}

.agent-info-card__select:disabled {
  background: #f5f5f5;
  color: var(--agent-muted);
  cursor: not-allowed;
}

.agent-info-card__config-button {
  width: 100%;
  min-width: 0;
  min-height: 43px;
  padding: 10px 12px;
  border: 1px solid var(--agent-border-strong);
  border-radius: 14px;
  background: #ffffff;
  color: var(--agent-text);
  cursor: pointer;
  text-align: center;
  font-size: 0.92rem;
  font-weight: 650;
  line-height: 1.4;
  outline: none;
}

.agent-info-card__config-button:hover:not(:disabled) {
  background: #f7f7f7;
  border-color: #cfcfcf;
}

.agent-info-card__config-button:disabled {
  background: #f5f5f5;
  color: var(--agent-muted);
  cursor: not-allowed;
}

.agent-info-card__button {
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid var(--agent-border-strong);
  border-radius: 14px;
  background: #ffffff;
  color: var(--agent-text);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 0.92rem;
  line-height: 1.45;
}

.agent-info-card__button:hover {
  background: #f7f7f7;
}

.agent-info-card__mini-action {
  width: fit-content;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--agent-border-strong);
  border-radius: 999px;
  background: #ffffff;
  color: #4f4f4f;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
}

.agent-info-card__mini-action:hover:not(:disabled) {
  background: #f7f7f7;
  color: #171717;
}

.agent-info-card__mini-action:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}

.agent-info-card__meta {
  color: var(--agent-subtle);
  font-size: 0.82rem;
  line-height: 1.6;
}

.agent-info-card--files {
  align-content: start;
}

.agent-info-card--files > .agent-info-card__label {
  font-size: 0;
  letter-spacing: 0;
}

.agent-info-card--files > .agent-info-card__label::before {
  content: '当前对话文件';
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.agent-file-list {
  display: grid;
  gap: 6px;
}

.agent-file-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  column-gap: 8px;
  padding: 4px 2px;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.agent-file-item:hover {
  background: #f4f7ff;
}

.agent-file-item.is-active {
  background: #e8f1ff;
}

.agent-file-item__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
}

.agent-file-item__path {
  margin: 0;
  color: #2b63d9;
  font-size: 0.9rem;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: underline;
  text-decoration-color: rgba(43, 99, 217, 0.28);
  text-underline-offset: 2px;
}

.agent-file-item:hover .agent-file-item__path {
  color: #1f4fb3;
  text-decoration-color: rgba(31, 79, 179, 0.42);
}

.agent-code-viewer {
  display: grid;
  flex: 0 0 var(--agent-preview-width);
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  width: var(--agent-preview-width);
  min-width: var(--agent-preview-width);
  max-width: var(--agent-preview-width);
  padding: 22px 20px;
  border-radius: 24px;
  background: #ffffff;
  border: 1px solid var(--agent-border);
}

.agent-code-viewer__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.agent-code-viewer__head-copy {
  min-width: 0;
}

.agent-code-viewer__head-copy h3,
.agent-code-viewer__head-copy p,
.agent-code-viewer__head-copy small {
  margin: 0;
}

.agent-code-viewer__head-copy h3 {
  margin-top: 6px;
  color: var(--agent-text);
  font-size: 1rem;
  line-height: 1.5;
  word-break: break-word;
}

.agent-code-viewer__head-copy small {
  display: block;
  margin-top: 8px;
  color: var(--agent-subtle);
  font-size: 0.78rem;
}

.agent-code-viewer__copy,
.agent-code-viewer__close {
  width: 34px;
  height: 34px;
  border: 1px solid #e4e8ef;
  border-radius: 10px;
  background: #f8fafc;
  color: #444444;
  cursor: pointer;
  font: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease, opacity 160ms ease;
}

.agent-code-viewer__copy {
  line-height: 1;
}

.agent-code-viewer__copy svg {
  width: 15px;
  height: 15px;
  flex: none;
}

.agent-code-viewer__copy:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.agent-code-viewer__close {
  padding: 0;
}

.agent-code-viewer__close svg {
  width: 15px;
  height: 15px;
  flex: none;
}

.agent-code-viewer__copy:hover:not(:disabled),
.agent-code-viewer__close:hover {
  background: #eef3ff;
  border-color: #d4defc;
  color: #264db7;
}

.agent-code-viewer__copy--overlay {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  box-shadow: 0 8px 24px rgba(31, 41, 55, 0.08);
}

.agent-code-viewer__copy--overlay.is-copied {
  background: #eaf7ee;
  border-color: #cbe9d5;
  color: #227a48;
}

.agent-code-viewer__body-wrap {
  position: relative;
  min-height: 0;
  display: grid;
}

.agent-code-viewer__copy-toast {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 2;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(34, 122, 72, 0.94);
  color: #ffffff;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 10px 28px rgba(34, 122, 72, 0.22);
  pointer-events: none;
}

.agent-code-viewer__status {
  margin: 0;
}

.agent-code-viewer__body {
  min-height: 0;
  height: 100%;
  margin: 0;
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--agent-border);
  border-radius: 18px;
  background: #ffffff;
  color: var(--agent-text);
  font-family: Consolas, "SFMono-Regular", Menlo, Monaco, monospace;
  font-size: 0.86rem;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-code-viewer__body code {
  display: block;
  min-height: 100%;
  background: transparent;
  padding: 0;
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

@media (max-width: 1180px) {
  .agent-shell {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .agent-shell.has-file-preview {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .agent-shell.is-sidebar-hidden,
  .agent-shell.is-sidebar-hidden.has-file-preview {
    grid-template-columns: minmax(0, 1fr);
  }

  .agent-shell__inspector {
    display: none;
  }

  .agent-shell__resizer {
    display: none;
  }

  .agent-shell__preview {
    position: fixed;
    inset: 12px;
    z-index: 30;
    display: flex;
    justify-content: stretch;
    padding: 0;
    background: transparent;
    opacity: 0;
    transform: translateX(18px);
    pointer-events: none;
  }

  .agent-shell__preview.is-visible {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }

  .agent-code-viewer {
    width: 100%;
    min-width: 0;
    max-width: none;
    flex: 1 1 auto;
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
  }
}

@media (max-width: 920px) {
  .agent-shell {
    grid-template-columns: 1fr;
  }

  .agent-shell__sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--agent-border);
  }

  .agent-conversation__starter-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .agent-shell {
    --agent-content-width: 100%;
  }

  .agent-mainbar {
    min-height: auto;
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
  }

  .agent-mainbar__status {
    display: none;
  }

  .agent-mainbar__copy h2 {
    margin-top: 0;
    font-size: 1rem;
  }

  .agent-mainbar__actions {
    width: 100%;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }

  .agent-mainbar__actions::-webkit-scrollbar {
    display: none;
  }

  .agent-context-badge,
  .agent-token-badge,
  .agent-mode-badge,
  .agent-task-badge {
    flex: 0 0 auto;
    min-height: 28px;
    padding: 0 10px;
    font-size: 0.74rem;
  }

  .agent-conversation__status {
    top: 16px;
    left: 14px;
    right: 14px;
  }

  .agent-conversation__messages {
    gap: 22px;
    padding: 18px 12px 162px;
  }

  .agent-conversation__welcome {
    min-height: auto;
    padding: 28px 0;
  }

  .agent-conversation__welcome-copy {
    justify-items: start;
    text-align: left;
  }

  .agent-message--user {
    max-width: 100%;
  }

  .agent-message__actions {
    opacity: 1;
    transform: none;
  }

  .agent-composer {
    width: calc(100% - 24px);
    min-height: 104px;
    gap: 10px;
    margin-bottom: 12px;
    padding: 12px;
    border-radius: 22px;
  }

  .agent-composer__input {
    min-height: 54px;
    max-height: 140px;
    font-size: 16px;
  }

  .agent-composer__actions {
    align-items: center;
    justify-content: stretch;
  }

  .agent-composer__upload {
    flex: 0 0 38px;
  }

  .agent-composer__send,
  .agent-composer__stop {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 12px;
  }

  .agent-shell__preview {
    inset: 8px;
  }

  .agent-code-viewer {
    gap: 10px;
    padding: 16px;
    border-radius: 18px;
  }

  .agent-code-viewer__head {
    align-items: center;
  }

  .agent-code-viewer__head-copy h3 {
    font-size: 0.94rem;
  }

  .agent-code-viewer__head-copy small {
    margin-top: 4px;
    font-size: 0.72rem;
  }

  .agent-code-viewer__body {
    padding: 12px;
    border-radius: 14px;
    font-size: 0.78rem;
    line-height: 1.65;
  }

  .agent-skill-picker {
    align-items: end;
    padding: 10px;
  }

  .agent-skill-picker__panel {
    width: 100%;
    height: min(86dvh, 760px);
    max-height: 86dvh;
    padding: 16px;
    border-radius: 22px;
  }

  .agent-skill-picker__head {
    align-items: center;
  }

  .agent-session-extra {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .agent-session-extra__nav {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--agent-border);
  }

  .agent-session-extra__nav-item {
    min-width: 126px;
  }

  .agent-session-extra__content {
    padding: 14px;
  }
}

@media (max-width: 520px) {
  .agent-conversation__messages {
    padding-inline: 10px;
  }

  .agent-message--user .agent-message__bubble {
    max-width: 92vw;
  }

  .agent-tool-card {
    border-radius: 16px;
  }

  .agent-composer {
    width: calc(100% - 16px);
    margin-bottom: 8px;
  }

  .agent-skill-picker__panel {
    height: min(90dvh, 760px);
    max-height: 90dvh;
  }
}
</style>
