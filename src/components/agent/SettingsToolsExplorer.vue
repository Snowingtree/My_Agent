<template>
  <section class="settings-tools">
    <section class="settings-tools__directory">
      <div class="settings-tools__head">
        <div>
          <p class="settings-tools__eyebrow">当前 Agent 能力</p>
          <h3>工具与子 Agent</h3>
        </div>
        <span class="settings-tools__count">{{ items.length }} 项</span>
      </div>

      <p v-if="listError" class="settings-tools__status is-error">{{ listError }}</p>
      <p v-else-if="isLoadingList" class="settings-tools__status">正在读取能力目录...</p>
      <p v-else-if="!items.length" class="settings-tools__status">当前还没有可展示的能力。</p>

      <div v-else class="settings-tools__table-wrap">
        <table class="settings-tools__table">
          <thead>
            <tr>
              <th scope="col">类型</th>
              <th scope="col">名称</th>
              <th scope="col">用途</th>
              <th scope="col">权限 / 参数</th>
              <th scope="col">入口</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in sortedItems"
              :key="`${item.kind}:${item.name}`"
              :class="{ 'is-active': item.name === selectedItemName }"
              tabindex="0"
              @click="selectItem(item.name)"
              @keydown.enter.prevent="selectItem(item.name)"
              @keydown.space.prevent="selectItem(item.name)"
            >
              <td>
                <span class="settings-tools__type" :class="`is-${item.kind || 'tool'}`">
                  {{ item.kind === 'subagent' ? '子 Agent' : '工具' }}
                </span>
              </td>
              <td>
                <strong>{{ item.label || item.name }}</strong>
                <small v-if="item.label">{{ item.name }}</small>
              </td>
              <td>{{ item.description || '暂无说明。' }}</td>
              <td>{{ getCapabilitySummary(item) }}</td>
              <td>{{ item.displayPath || '内置能力' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <aside class="settings-tools__detail">
      <div v-if="selectedItemDetail" class="settings-tools__detail-content">
        <p class="settings-tools__eyebrow">能力说明</p>
        <div class="settings-tools__detail-title">
          <h3>{{ selectedItemDetail.label || selectedItemDetail.name }}</h3>
          <span class="settings-tools__type" :class="`is-${selectedItemDetail.kind || 'tool'}`">
            {{ selectedItemDetail.kind === 'subagent' ? '子 Agent' : '工具' }}
          </span>
        </div>
        <p v-if="selectedItemDetail.label" class="settings-tools__identifier">{{ selectedItemDetail.name }}</p>
        <p class="settings-tools__description">{{ selectedItemDetail.description || '暂无说明。' }}</p>

        <dl class="settings-tools__facts">
          <template v-if="selectedItemDetail.kind === 'subagent'">
            <dt>调用方式</dt>
            <dd>由主 Agent 调用 <code>delegate_task</code>，并传入 <code>agent: '{{ selectedItemDetail.name }}'</code>。</dd>
            <dt>可用权限</dt>
            <dd>{{ selectedItemDetail.allowedTools?.join('、') || '仅接收任务说明' }}</dd>
          </template>
          <template v-else>
            <dt>来源</dt>
            <dd>{{ getSourceLabel(selectedItemDetail) }}</dd>
            <dt>参数</dt>
            <dd>{{ getParameterSummary(selectedItemDetail) }}</dd>
          </template>
        </dl>
      </div>

      <p v-else-if="detailError" class="settings-tools__status is-error">{{ detailError }}</p>
      <p v-else-if="isLoadingDetail" class="settings-tools__status">正在读取能力说明...</p>
      <p v-else class="settings-tools__status">从表格选择一项，查看能力说明。</p>
    </aside>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import http from '../../http.js'

const items = ref([])
const selectedItemName = ref('')
const selectedItemDetail = ref(null)
const isLoadingList = ref(false)
const isLoadingDetail = ref(false)
const listError = ref('')
const detailError = ref('')

function getParameterNames(item) {
  const properties = item?.inputSchema?.properties
  return properties && typeof properties === 'object' ? Object.keys(properties) : []
}

function getCapabilitySummary(item) {
  if (item?.kind === 'subagent') {
    return Array.isArray(item.allowedTools) && item.allowedTools.length
      ? item.allowedTools.join('、')
      : '只读分析'
  }

  const names = getParameterNames(item)
  return names.length ? names.join('、') : '无参数'
}

function getSourceLabel(item) {
  const source = String(item?.source || '').toLowerCase()

  if (source === 'mcp') return 'MCP 工具'
  if (source === 'subagent') return '子 Agent 委派工具'
  return '内置工具'
}

function getParameterSummary(item) {
  const names = getParameterNames(item)
  return names.length ? names.join('、') : '此工具无需参数。'
}

const sortedItems = computed(() => [...items.value].sort((left, right) => {
  const typeOrder = left.kind === right.kind ? 0 : left.kind === 'tool' ? -1 : 1
  return typeOrder || String(left.label || left.name).localeCompare(String(right.label || right.name), 'zh-CN')
}))

async function loadDirectory() {
  isLoadingList.value = true
  listError.value = ''

  try {
    const response = await http.get('/api/agent/tools')
    items.value = Array.isArray(response?.items) ? response.items : []

    if (!items.value.length) {
      selectedItemName.value = ''
      selectedItemDetail.value = null
      return
    }

    if (!items.value.some((item) => item.name === selectedItemName.value)) {
      await selectItem(sortedItems.value[0].name)
    }
  } catch (error) {
    listError.value = error instanceof Error ? error.message : '读取能力目录失败。'
    items.value = []
    selectedItemName.value = ''
    selectedItemDetail.value = null
  } finally {
    isLoadingList.value = false
  }
}

async function selectItem(name) {
  selectedItemName.value = name
  isLoadingDetail.value = true
  detailError.value = ''

  try {
    const response = await http.get('/api/agent/tool-detail', { params: { name } })
    selectedItemDetail.value = response?.item || null
  } catch (error) {
    selectedItemDetail.value = null
    detailError.value = error instanceof Error ? error.message : '读取能力说明失败。'
  } finally {
    isLoadingDetail.value = false
  }
}

onMounted(() => {
  void loadDirectory()
})
</script>

<style scoped>
.settings-tools { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; min-height: 500px; }
.settings-tools__directory, .settings-tools__detail { min-width: 0; border: 1px solid #e2e7ef; border-radius: 8px; background: #fff; }
.settings-tools__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid #e9edf3; }
.settings-tools__eyebrow { margin: 0 0 6px; color: #71809a; font-size: 0.75rem; font-weight: 700; letter-spacing: 0; }
.settings-tools__head h3, .settings-tools__detail h3 { margin: 0; color: #162033; font-size: 1.05rem; }
.settings-tools__count { flex: 0 0 auto; color: #61718d; font-size: 0.82rem; }
.settings-tools__table-wrap { overflow: auto; }
.settings-tools__table { width: 100%; min-width: 760px; border-collapse: collapse; table-layout: fixed; }
.settings-tools__table th, .settings-tools__table td { padding: 14px 16px; border-bottom: 1px solid #edf0f5; color: #49576d; font-size: 0.86rem; line-height: 1.55; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.settings-tools__table th { color: #71809a; background: #fafbfd; font-size: 0.76rem; font-weight: 700; }
.settings-tools__table th:nth-child(1) { width: 88px; }.settings-tools__table th:nth-child(2) { width: 150px; }.settings-tools__table th:nth-child(4) { width: 160px; }.settings-tools__table th:nth-child(5) { width: 150px; }
.settings-tools__table tbody tr { cursor: pointer; }.settings-tools__table tbody tr:hover, .settings-tools__table tbody tr.is-active { background: #f4f8ff; }.settings-tools__table tbody tr:focus { outline: none; }.settings-tools__table tbody tr:focus-visible { outline: 2px solid #4a7fe8; outline-offset: -2px; }
.settings-tools__table strong { display: block; color: #1b2a43; font-size: 0.9rem; }.settings-tools__table small { display: block; margin-top: 3px; color: #8390a5; font-size: 0.76rem; }
.settings-tools__type { display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; border-radius: 4px; background: #edf2fa; color: #53647d; font-size: 0.74rem; font-weight: 700; white-space: nowrap; }.settings-tools__type.is-subagent { background: #e8f5ec; color: #287248; }
.settings-tools__detail { padding: 20px; }.settings-tools__detail-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }.settings-tools__identifier { margin: 8px 0 0; color: #70809a; font-family: Consolas, 'SFMono-Regular', Menlo, monospace; font-size: 0.82rem; }.settings-tools__description { margin: 18px 0 0; color: #36445a; font-size: 0.92rem; line-height: 1.7; }
.settings-tools__facts { display: grid; gap: 8px; margin: 24px 0 0; }.settings-tools__facts dt { color: #71809a; font-size: 0.76rem; font-weight: 700; }.settings-tools__facts dd { margin: 0 0 12px; color: #344257; font-size: 0.85rem; line-height: 1.65; overflow-wrap: anywhere; }.settings-tools__facts code { padding: 1px 4px; border-radius: 3px; background: #f1f4f8; color: #26364e; font-family: Consolas, 'SFMono-Regular', Menlo, monospace; font-size: 0.8rem; }
.settings-tools__status { margin: 0; padding: 20px; color: #6f7d91; font-size: 0.9rem; line-height: 1.6; }.settings-tools__status.is-error { color: #b33d34; }
@media (max-width: 1080px) { .settings-tools { grid-template-columns: 1fr; }.settings-tools__detail { min-height: 260px; } }
</style>
