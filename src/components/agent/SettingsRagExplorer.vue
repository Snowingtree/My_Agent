<template>
  <section class="settings-rag">
    <header class="settings-rag__hero">
      <div>
        <p class="settings-rag__eyebrow">RAG Knowledge Base</p>
        <h3>知识库</h3>
        <p>可以创建多个知识库。上传文档时会写入当前选中的知识库。</p>
      </div>
      <div class="settings-rag__status" :class="{ 'is-ready': ragStatus.ready, 'is-error': ragStatus.enabled && !ragStatus.ready }">
        <strong>{{ ragStatus.ready ? '已连接' : '未就绪' }}</strong>
        <span>{{ ragStatus.ready ? `pgvector ${ragStatus.vectorVersion || ''}` : (ragStatus.error || ragStatus.reason || '等待初始化') }}</span>
      </div>
    </header>

    <section class="settings-rag__collections">
      <article class="settings-rag__panel">
        <div class="settings-rag__panel-head">
          <h4>知识库列表</h4>
          <span>{{ collections.length }} 个知识库</span>
        </div>

        <div v-if="collections.length" class="settings-rag__collection-list">
          <button
            v-for="item in collections"
            :key="item.collectionId"
            type="button"
            class="settings-rag__collection"
            :class="{ 'is-active': item.collectionId === selectedCollectionId }"
            @click="selectCollection(item.collectionId)"
          >
            <strong>{{ item.name }}</strong>
            <span>{{ item.documentCount || 0 }} 个文档 / {{ item.chunkCount || 0 }} 个切片</span>
          </button>
        </div>
        <p v-else class="settings-rag__empty">还没有知识库。</p>
      </article>

      <article class="settings-rag__panel">
        <div class="settings-rag__panel-head">
          <h4>新增知识库</h4>
          <span>用于区分不同资料范围</span>
        </div>

        <form class="settings-rag__create" @submit.prevent="createCollection">
          <input v-model="newCollectionName" type="text" placeholder="例如：Agent 项目、论文资料、产品文档" />
          <textarea v-model="newCollectionDescription" rows="3" placeholder="描述，可选"></textarea>
          <button type="submit" :disabled="!newCollectionName.trim() || isCreatingCollection">
            {{ isCreatingCollection ? '创建中...' : '创建知识库' }}
          </button>
        </form>
      </article>
    </section>

    <section class="settings-rag__grid">
      <article class="settings-rag__panel">
        <div class="settings-rag__panel-head">
          <h4>上传文档</h4>
          <span>当前：{{ selectedCollectionName }}</span>
        </div>

        <label class="settings-rag__upload">
          <input type="file" accept=".txt,.md,.markdown,.docx" multiple @change="handleFileChange" />
          <strong>选择文件</strong>
          <span>{{ selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : '支持 TXT / Markdown / DOCX' }}</span>
        </label>

        <div v-if="selectedFiles.length" class="settings-rag__selected">
          <span v-for="file in selectedFiles" :key="`${file.name}-${file.size}`">{{ file.name }}</span>
        </div>

        <button type="button" class="settings-rag__primary" :disabled="!selectedFiles.length || isUploading || !selectedCollectionId" @click="uploadFiles">
          {{ isUploading ? '入库中...' : '上传并入库' }}
        </button>

        <p v-if="uploadMessage" class="settings-rag__message">{{ uploadMessage }}</p>
        <p v-if="uploadError" class="settings-rag__message is-error">{{ uploadError }}</p>
      </article>

      <article class="settings-rag__panel">
        <div class="settings-rag__panel-head">
          <h4>检索测试</h4>
          <span>只检索当前知识库</span>
        </div>

        <form class="settings-rag__search" @submit.prevent="searchKnowledge">
          <input v-model="searchQuery" type="text" placeholder="输入关键词，例如：部署、接口、规范" />
          <button type="submit" :disabled="!searchQuery.trim() || isSearching">搜索</button>
        </form>

        <div v-if="searchResults.length" class="settings-rag__results">
          <article v-for="item in searchResults" :key="item.chunkId">
            <strong>{{ item.title }}</strong>
            <p>{{ item.content }}</p>
          </article>
        </div>
        <p v-else class="settings-rag__empty">{{ isSearching ? '正在检索...' : '暂无检索结果。' }}</p>
      </article>
    </section>

    <section class="settings-rag__panel settings-rag__documents">
      <div class="settings-rag__panel-head">
        <h4>当前知识库文档</h4>
        <span>{{ documents.length }} 个文档</span>
      </div>

      <p v-if="listError" class="settings-rag__message is-error">{{ listError }}</p>
      <p v-else-if="isLoading" class="settings-rag__empty">正在读取知识库...</p>
      <p v-else-if="!documents.length" class="settings-rag__empty">当前知识库还没有文档。</p>

      <div v-else class="settings-rag__table">
        <div class="settings-rag__row settings-rag__row--head">
          <span>标题</span>
          <span>来源</span>
          <span>切片</span>
          <span>更新时间</span>
          <span>操作</span>
        </div>
        <div v-for="item in documents" :key="item.documentId" class="settings-rag__row">
          <span>{{ item.title }}</span>
          <span>{{ item.sourcePath || item.sourceType }}</span>
          <span>{{ item.chunkCount }}</span>
          <span>{{ formatDate(item.updatedAt) }}</span>
          <button type="button" @click="deleteDocument(item.documentId)">删除</button>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import http from '../../http.js'

const ragStatus = ref({})
const collections = ref([])
const documents = ref([])
const selectedCollectionId = ref('')
const selectedFiles = ref([])
const searchQuery = ref('')
const searchResults = ref([])
const newCollectionName = ref('')
const newCollectionDescription = ref('')
const isLoading = ref(false)
const isUploading = ref(false)
const isSearching = ref(false)
const isCreatingCollection = ref(false)
const listError = ref('')
const uploadError = ref('')
const uploadMessage = ref('')

const selectedCollectionName = computed(() => {
  return collections.value.find((item) => item.collectionId === selectedCollectionId.value)?.name || '未选择'
})

function handleFileChange(event) {
  selectedFiles.value = Array.from(event.target.files || [])
  uploadError.value = ''
  uploadMessage.value = ''
}

function formatDate(value) {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

async function loadStatus() {
  ragStatus.value = await http.get('/api/agent/rag/status')
}

async function loadCollections() {
  const response = await http.get('/api/agent/rag/collections')
  collections.value = Array.isArray(response?.items) ? response.items : []

  if (!selectedCollectionId.value || !collections.value.some((item) => item.collectionId === selectedCollectionId.value)) {
    selectedCollectionId.value = collections.value[0]?.collectionId || ''
  }
}

async function loadDocuments() {
  isLoading.value = true
  listError.value = ''

  try {
    await loadStatus()
    await loadCollections()
    const response = await http.get('/api/agent/rag/documents', {
      params: { collectionId: selectedCollectionId.value }
    })
    documents.value = Array.isArray(response?.items) ? response.items : []
  } catch (error) {
    listError.value = error instanceof Error ? error.message : '读取知识库失败。'
    documents.value = []
  } finally {
    isLoading.value = false
  }
}

async function selectCollection(collectionId) {
  selectedCollectionId.value = collectionId
  searchResults.value = []
  await loadDocuments()
}

async function createCollection() {
  const name = newCollectionName.value.trim()
  if (!name) return

  isCreatingCollection.value = true
  try {
    const response = await http.post('/api/agent/rag/collections', {
      name,
      description: newCollectionDescription.value.trim()
    })
    newCollectionName.value = ''
    newCollectionDescription.value = ''
    selectedCollectionId.value = response?.item?.collectionId || selectedCollectionId.value
    await loadDocuments()
  } finally {
    isCreatingCollection.value = false
  }
}

async function uploadFiles() {
  if (!selectedFiles.value.length || !selectedCollectionId.value) return

  isUploading.value = true
  uploadError.value = ''
  uploadMessage.value = ''

  try {
    let uploadedCount = 0
    for (const file of selectedFiles.value) {
      const formData = new FormData()
      formData.append('collectionId', selectedCollectionId.value)
      formData.append('file', file)
      await http.post('/api/agent/rag/upload', formData)
      uploadedCount += 1
    }
    selectedFiles.value = []
    uploadMessage.value = `已入库 ${uploadedCount} 个文件。`
    await loadDocuments()
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : '上传入库失败。'
  } finally {
    isUploading.value = false
  }
}

async function searchKnowledge() {
  const query = searchQuery.value.trim()
  if (!query) return

  isSearching.value = true
  searchResults.value = []

  try {
    const response = await http.get('/api/agent/rag/search', {
      params: { q: query, collectionId: selectedCollectionId.value }
    })
    searchResults.value = Array.isArray(response?.items) ? response.items : []
  } finally {
    isSearching.value = false
  }
}

async function deleteDocument(documentId) {
  if (!documentId || !window.confirm('确定删除这个知识库文档吗？')) return
  await http.delete(`/api/agent/rag/documents/${encodeURIComponent(documentId)}`)
  await loadDocuments()
}

onMounted(() => {
  void loadDocuments()
})
</script>

<style scoped>
.settings-rag {
  display: grid;
  gap: 18px;
}

.settings-rag__hero,
.settings-rag__panel {
  border: 1px solid #e7ebf3;
  border-radius: 22px;
  background: #ffffff;
  padding: 20px;
}

.settings-rag__hero {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
}

.settings-rag__eyebrow {
  margin: 0 0 8px;
  color: #7a869f;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.settings-rag h3,
.settings-rag h4,
.settings-rag p {
  margin: 0;
}

.settings-rag h3 {
  font-size: 1.35rem;
}

.settings-rag__hero p:not(.settings-rag__eyebrow) {
  margin-top: 8px;
  color: #667085;
}

.settings-rag__status {
  display: grid;
  gap: 4px;
  min-width: 160px;
  padding: 12px 14px;
  border-radius: 16px;
  background: #fff7ed;
  color: #9a3412;
}

.settings-rag__status.is-ready {
  background: #ecfdf3;
  color: #087443;
}

.settings-rag__status.is-error {
  background: #fff1f2;
  color: #be123c;
}

.settings-rag__status span,
.settings-rag__panel-head span,
.settings-rag__empty {
  color: #7a869f;
}

.settings-rag__collections,
.settings-rag__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
}

.settings-rag__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.settings-rag__collection-list {
  display: grid;
  gap: 8px;
}

.settings-rag__collection {
  display: grid;
  gap: 4px;
  width: 100%;
  border: 0;
  border-radius: 14px;
  background: #f8fafc;
  padding: 12px;
  text-align: left;
  cursor: pointer;
}

.settings-rag__collection.is-active {
  background: #171717;
  color: #ffffff;
}

.settings-rag__collection span {
  color: #7a869f;
}

.settings-rag__collection.is-active span {
  color: rgba(255, 255, 255, 0.72);
}

.settings-rag__create,
.settings-rag__search {
  display: grid;
  gap: 10px;
}

.settings-rag__create input,
.settings-rag__create textarea,
.settings-rag__search input {
  min-width: 0;
  border: 1px solid #d9dee9;
  border-radius: 14px;
  padding: 11px 13px;
  font: inherit;
}

.settings-rag__upload {
  display: grid;
  gap: 8px;
  place-items: center;
  min-height: 150px;
  border: 1px dashed #b8c2d6;
  border-radius: 18px;
  background: #f8fafc;
  cursor: pointer;
}

.settings-rag__upload input {
  display: none;
}

.settings-rag__selected {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.settings-rag__selected span {
  padding: 6px 10px;
  border-radius: 999px;
  background: #eef2ff;
  color: #3447a8;
  font-size: 0.82rem;
}

.settings-rag__primary,
.settings-rag__create button,
.settings-rag__search button,
.settings-rag__row button {
  border: 0;
  border-radius: 999px;
  background: #171717;
  color: #ffffff;
  cursor: pointer;
  font: inherit;
}

.settings-rag__primary {
  width: 100%;
  margin-top: 14px;
  padding: 12px 16px;
  font-weight: 700;
}

.settings-rag__create button,
.settings-rag__search button {
  padding: 11px 18px;
}

.settings-rag__primary:disabled,
.settings-rag__create button:disabled,
.settings-rag__search button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.settings-rag__message {
  margin-top: 12px;
  color: #087443;
  line-height: 1.6;
}

.settings-rag__message.is-error {
  color: #be123c;
}

.settings-rag__search {
  grid-template-columns: minmax(0, 1fr) auto;
}

.settings-rag__results {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  max-height: 280px;
  overflow: auto;
}

.settings-rag__results article {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 14px;
  background: #f8fafc;
}

.settings-rag__results p {
  color: #465165;
  line-height: 1.65;
  white-space: pre-wrap;
}

.settings-rag__table {
  display: grid;
  border: 1px solid #edf0f5;
  border-radius: 16px;
  overflow: hidden;
}

.settings-rag__row {
  display: grid;
  grid-template-columns: minmax(180px, 1.5fr) minmax(160px, 1fr) 90px 130px 80px;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid #edf0f5;
}

.settings-rag__row:last-child {
  border-bottom: 0;
}

.settings-rag__row--head {
  background: #f8fafc;
  color: #6b7280;
  font-weight: 700;
}

.settings-rag__row button {
  padding: 8px 12px;
  background: #f3f4f6;
  color: #374151;
}

@media (max-width: 1080px) {
  .settings-rag__collections,
  .settings-rag__grid,
  .settings-rag__row {
    grid-template-columns: 1fr;
  }
}
</style>
