<template>
  <section class="settings-tools">
    <aside class="settings-tools__sidebar">
      <div class="settings-tools__sidebar-head">
        <div>
          <p class="settings-tools__eyebrow">当前 Agent 工具</p>
          <h3>工具目录</h3>
        </div>
      </div>

      <p v-if="listError" class="settings-tools__status is-error">{{ listError }}</p>
      <p v-else-if="isLoadingList" class="settings-tools__status">正在读取工具列表...</p>
      <p v-else-if="!tools.length" class="settings-tools__status">当前还没有可展示的工具。</p>

      <div v-else class="settings-tools__list">
        <button
          v-for="tool in tools"
          :key="tool.name"
          :ref="(element) => setToolItemRef(tool.name, element)"
          type="button"
          class="settings-tools__item"
          :class="{ 'is-active': tool.name === selectedToolName }"
          :tabindex="tool.name === selectedToolName ? 0 : -1"
          :aria-current="tool.name === selectedToolName ? 'true' : undefined"
          @click="selectTool(tool.name)"
          @keydown="handleToolItemKeydown($event, tool.name)"
        >
          <strong>{{ tool.name }}</strong>
          <span>{{ tool.source === 'mcp' ? 'MCP 工具' : (tool.displayPath || '未提供路径') }}</span>
        </button>
      </div>
    </aside>

    <section class="settings-tools__detail">
      <div class="settings-tools__detail-head">
        <div v-if="selectedToolDetail">
          <p class="settings-tools__eyebrow">源码预览</p>
          <h3>{{ selectedToolDetail.name }}</h3>
          <p class="settings-tools__meta">
            <span>{{ selectedToolDetail.source === 'mcp' ? 'MCP' : '内置工具' }}</span>
            <span>{{ selectedToolDetail.displayPath || '未提供路径' }}</span>
          </p>
          <p class="settings-tools__description">{{ selectedToolDetail.description || '暂无说明。' }}</p>
        </div>
      </div>

      <p v-if="detailError" class="settings-tools__status is-error">{{ detailError }}</p>
      <p v-else-if="isLoadingDetail" class="settings-tools__status">正在读取工具源码...</p>
      <p v-else-if="!selectedToolDetail" class="settings-tools__status">从左侧选择一个工具，查看具体实现。</p>

      <pre v-else class="settings-tools__code"><code class="hljs" v-html="highlightedToolContent"></code></pre>
    </section>
  </section>
</template>

<script setup>
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { computed, nextTick, onMounted, ref } from 'vue'
import http from '../../http.js'

const tools = ref([])
const selectedToolName = ref('')
const selectedToolDetail = ref(null)
const isLoadingList = ref(false)
const isLoadingDetail = ref(false)
const listError = ref('')
const detailError = ref('')
const toolItemRefs = new Map()

function isVisibleSettingsTool(tool) {
  return String(tool?.source || '').trim().toLowerCase() !== 'mcp'
}

const highlightedToolContent = computed(() => {
  const content = String(selectedToolDetail.value?.content || '')
  const language = String(selectedToolDetail.value?.language || '').trim().toLowerCase()

  if (!content) {
    return ''
  }

  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(content, { language }).value
  }

  return hljs.highlightAuto(content).value
})

function setToolItemRef(toolName, element) {
  const normalizedName = String(toolName || '')

  if (!normalizedName) {
    return
  }

  if (element) {
    toolItemRefs.set(normalizedName, element)
  } else {
    toolItemRefs.delete(normalizedName)
  }
}

function focusToolItem(toolName) {
  void nextTick(() => {
    const element = toolItemRefs.get(toolName)

    if (element && typeof element.focus === 'function') {
      element.focus()
    }
  })
}

function resolveToolIndexForKeyboard(currentToolName) {
  const currentIndex = tools.value.findIndex((item) => item.name === currentToolName)

  if (currentIndex >= 0) {
    return currentIndex
  }

  const selectedIndex = tools.value.findIndex((item) => item.name === selectedToolName.value)
  return selectedIndex >= 0 ? selectedIndex : 0
}

async function moveToolSelection(currentToolName, direction) {
  if (!tools.value.length) {
    return
  }

  const currentIndex = resolveToolIndexForKeyboard(currentToolName)
  const lastIndex = tools.value.length - 1
  const nextIndex = direction === 'previous'
    ? (currentIndex <= 0 ? lastIndex : currentIndex - 1)
    : (currentIndex >= lastIndex ? 0 : currentIndex + 1)
  const nextToolName = tools.value[nextIndex]?.name

  if (!nextToolName) {
    return
  }

  await selectTool(nextToolName)
  focusToolItem(nextToolName)
}

function handleToolItemKeydown(event, toolName) {
  const directionMap = {
    ArrowUp: 'previous',
    ArrowDown: 'next'
  }
  const direction = directionMap[event.key]

  if (!direction) {
    return
  }

  event.preventDefault()
  void moveToolSelection(toolName, direction)
}

async function loadToolList() {
  isLoadingList.value = true
  listError.value = ''

  try {
    const response = await http.get('/api/agent/tools')
    tools.value = Array.isArray(response?.items)
      ? response.items.filter(isVisibleSettingsTool)
      : []

    if (!tools.value.length) {
      selectedToolName.value = ''
      selectedToolDetail.value = null
      return
    }

    if (!selectedToolName.value || !tools.value.some((item) => item.name === selectedToolName.value)) {
      await selectTool(tools.value[0].name)
    }
  } catch (error) {
    listError.value = error instanceof Error ? error.message : '读取工具列表失败。'
    tools.value = []
    selectedToolName.value = ''
    selectedToolDetail.value = null
  } finally {
    isLoadingList.value = false
  }
}

async function selectTool(toolName) {
  selectedToolName.value = toolName
  isLoadingDetail.value = true
  detailError.value = ''

  try {
    const response = await http.get('/api/agent/tool-detail', {
      params: { name: toolName }
    })

    selectedToolDetail.value = response?.item || null
  } catch (error) {
    selectedToolDetail.value = null
    detailError.value = error instanceof Error ? error.message : '读取工具详情失败。'
  } finally {
    isLoadingDetail.value = false
  }
}

onMounted(() => {
  void loadToolList()
})
</script>

<style scoped>
.settings-tools {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 18px;
  height: 100%;
  min-height: 400px;
}

.settings-tools__sidebar,
.settings-tools__detail {
  min-width: 0;
  border: 1px solid #e7ebf3;
  border-radius: 20px;
  background: #ffffff;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.settings-tools__sidebar-head,
.settings-tools__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid #eef1f6;
}

.settings-tools__eyebrow {
  margin: 0 0 6px;
  color: #7a869f;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.settings-tools__sidebar-head h3,
.settings-tools__detail-head h3 {
  margin: 0;
  color: #171717;
  font-size: 1.1rem;
  font-weight: 700;
}

.settings-tools__list {
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 12px;
  overflow-y: auto;
}

.settings-tools__item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: #1d2a44;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background-color 160ms ease, transform 160ms ease;
}

.settings-tools__item:hover {
  background: #f4f7fc;
}

.settings-tools__item:focus {
  outline: none;
}

.settings-tools__item:focus-visible {
  background: #f4f7fc;
  box-shadow: inset 0 0 0 2px rgba(33, 77, 186, 0.18);
}

.settings-tools__item.is-active {
  background: #eaf1ff;
  color: #214dba;
}

.settings-tools__item.is-active:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(33, 77, 186, 0.24);
}

.settings-tools__item strong {
  font-size: 0.94rem;
  font-weight: 700;
}

.settings-tools__item span {
  color: #75819a;
  font-size: 0.78rem;
  line-height: 1.45;
  word-break: break-word;
}

.settings-tools__detail {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.settings-tools__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 10px 0 0;
  color: #6e7890;
  font-size: 0.82rem;
}

.settings-tools__description {
  margin: 10px 0 0;
  color: #364153;
  line-height: 1.6;
}

.settings-tools__status {
  margin: 0;
  padding: 18px;
  color: #6b7280;
  font-size: 0.94rem;
  line-height: 1.6;
}

.settings-tools__status.is-error {
  color: #b33d34;
}

.settings-tools__code {
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 18px;
  background: #ffffff;
  font-family: Consolas, 'SFMono-Regular', Menlo, Monaco, monospace;
  font-size: 0.86rem;
  line-height: 1.72;
}

.settings-tools__code code {
  display: block;
}

@media (max-width: 1080px) {
  .settings-tools {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr;
  }
}
</style>
