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
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in sortedItems"
              :key="`${item.kind}:${item.name}`"
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
            </tr>
          </tbody>
        </table>
      </div>
    </section>

  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import http from '../../http.js'

const items = ref([])
const isLoadingList = ref(false)
const listError = ref('')

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
      return
    }
  } catch (error) {
    listError.value = error instanceof Error ? error.message : '读取能力目录失败。'
    items.value = []
  } finally {
    isLoadingList.value = false
  }
}

onMounted(() => {
  void loadDirectory()
})
</script>

<style scoped>
.settings-tools { min-width: 0; }
.settings-tools__directory { min-width: 0; border: 1px solid #e2e7ef; border-radius: 8px; background: #fff; }
.settings-tools__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid #e9edf3; }
.settings-tools__eyebrow { margin: 0 0 6px; color: #71809a; font-size: 0.75rem; font-weight: 700; letter-spacing: 0; }
.settings-tools__head h3, .settings-tools__detail h3 { margin: 0; color: #162033; font-size: 1.05rem; }
.settings-tools__count { flex: 0 0 auto; color: #61718d; font-size: 0.82rem; }
.settings-tools__table-wrap { overflow: hidden; }
.settings-tools__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.settings-tools__table th, .settings-tools__table td { padding: 14px 16px; border-bottom: 1px solid #edf0f5; color: #49576d; font-size: 0.86rem; line-height: 1.55; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.settings-tools__table th { color: #71809a; background: #fafbfd; font-size: 0.76rem; font-weight: 700; }
.settings-tools__table th:nth-child(1) { width: 88px; }.settings-tools__table th:nth-child(2) { width: 180px; }
.settings-tools__table tbody tr:hover { background: #f8faff; }
.settings-tools__table strong { display: block; color: #1b2a43; font-size: 0.9rem; }.settings-tools__table small { display: block; margin-top: 3px; color: #8390a5; font-size: 0.76rem; }
.settings-tools__type { display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; border-radius: 4px; background: #edf2fa; color: #53647d; font-size: 0.74rem; font-weight: 700; white-space: nowrap; }.settings-tools__type.is-subagent { background: #e8f5ec; color: #287248; }
.settings-tools__status { margin: 0; padding: 20px; color: #6f7d91; font-size: 0.9rem; line-height: 1.6; }.settings-tools__status.is-error { color: #b33d34; }
@media (max-width: 640px) { .settings-tools__table th, .settings-tools__table td { padding: 12px 10px; font-size: 0.8rem; }.settings-tools__table th:nth-child(1) { width: 68px; }.settings-tools__table th:nth-child(2) { width: 112px; } }
</style>
