<template>
  <section class="settings-rag">
    <section class="settings-rag__top">
      <article class="settings-rag__panel settings-rag__panel--list">
        <div class="settings-rag__panel-head">
          <h4>知识库列表（{{ collections.length }}）</h4>
          <button type="button" class="settings-rag__add-btn" aria-label="新增知识库" @click="openCreateModal">+</button>
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

      <article class="settings-rag__panel settings-rag__panel--documents">
        <div class="settings-rag__panel-head">
          <h4>{{ selectedCollectionName }}（{{ documents.length }}）</h4>
          <button type="button" class="settings-rag__add-btn" aria-label="上传文档" :disabled="!selectedCollectionId" @click="openUploadModal">+</button>
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
      </article>
    </section>

    <Teleport to="body">
      <Transition name="settings-rag-modal">
        <div v-if="showCreateModal" class="settings-rag-modal" @click.self="closeCreateModal">
          <form class="settings-rag-modal__dialog" @submit.prevent="createCollection">
            <header>
              <div>
                <p>New Knowledge Base</p>
                <h3>新增知识库</h3>
              </div>
              <button type="button" aria-label="关闭" @click="closeCreateModal">×</button>
            </header>

            <label>
              <span>名称</span>
              <input v-model="newCollectionName" type="text" placeholder="例如：面试题、论文资料、产品文档" />
            </label>

            <label>
              <span>描述</span>
              <textarea v-model="newCollectionDescription" rows="4" placeholder="描述，可选"></textarea>
            </label>

            <footer>
              <button type="button" class="settings-rag-modal__secondary" @click="closeCreateModal">取消</button>
              <button type="submit" class="settings-rag-modal__primary" :disabled="!newCollectionName.trim() || isCreatingCollection">
                {{ isCreatingCollection ? '创建中...' : '创建知识库' }}
              </button>
            </footer>
          </form>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="settings-rag-modal">
        <div v-if="showUploadModal" class="settings-rag-modal" @click.self="closeUploadModal">
          <form class="settings-rag-modal__dialog" @submit.prevent="uploadFiles">
            <header>
              <div>
                <p>Upload Documents</p>
                <h3>上传文档</h3>
              </div>
              <button type="button" aria-label="关闭" @click="closeUploadModal">×</button>
            </header>

            <p class="settings-rag-modal__hint">当前知识库：{{ selectedCollectionName }}</p>

            <label>
              <span>Embedding 配置</span>
              <select v-model="selectedEmbeddingAiId" :disabled="isLoadingEmbeddingConfigs || !embeddingConfigs.length">
                <option value="">使用默认 embedding 配置</option>
                <option v-for="item in embeddingConfigs" :key="item.aiId" :value="item.aiId">
                  {{ item.name }}
                </option>
              </select>
            </label>

            <p v-if="embeddingConfigError" class="settings-rag__message is-error">{{ embeddingConfigError }}</p>

            <label class="settings-rag__upload settings-rag__upload--modal">
              <input type="file" accept=".txt,.md,.markdown,.docx" multiple @change="handleFileChange" />
              <strong>选择文档</strong>
              <span>{{ selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : '支持 TXT / Markdown / DOCX' }}</span>
            </label>

            <div v-if="selectedFiles.length" class="settings-rag__selected">
              <span v-for="file in selectedFiles" :key="`${file.name}-${file.size}`">{{ file.name }}</span>
            </div>

            <p v-if="uploadError" class="settings-rag__message is-error">{{ uploadError }}</p>

            <footer>
              <button type="button" class="settings-rag-modal__secondary" @click="closeUploadModal">取消</button>
              <button type="submit" class="settings-rag-modal__primary" :disabled="!selectedFiles.length || isUploading || !selectedCollectionId">
                {{ isUploading ? '入库中...' : '上传并入库' }}
              </button>
            </footer>
          </form>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import http from '../../http.js'

const collections = ref([])
const documents = ref([])
const selectedCollectionId = ref('')
const selectedFiles = ref([])
const newCollectionName = ref('')
const newCollectionDescription = ref('')
const isLoading = ref(false)
const isUploading = ref(false)
const isCreatingCollection = ref(false)
const listError = ref('')
const uploadError = ref('')
const uploadMessage = ref('')
const showCreateModal = ref(false)
const showUploadModal = ref(false)
const embeddingConfigs = ref([])
const selectedEmbeddingAiId = ref('')
const isLoadingEmbeddingConfigs = ref(false)
const embeddingConfigError = ref('')

const selectedCollectionName = computed(() => {
  return collections.value.find((item) => item.collectionId === selectedCollectionId.value)?.name || '未选择知识库'
})

function openCreateModal() {
  newCollectionName.value = ''
  newCollectionDescription.value = ''
  showCreateModal.value = true
}

function closeCreateModal() {
  if (isCreatingCollection.value) return
  showCreateModal.value = false
}

function openUploadModal() {
  selectedFiles.value = []
  uploadError.value = ''
  uploadMessage.value = ''
  embeddingConfigError.value = ''
  showUploadModal.value = true
  void loadEmbeddingConfigs()
}

function closeUploadModal() {
  if (isUploading.value) return
  showUploadModal.value = false
  selectedFiles.value = []
  uploadError.value = ''
}

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
  await http.get('/api/agent/rag/status')
}

async function loadEmbeddingConfigs() {
  isLoadingEmbeddingConfigs.value = true
  embeddingConfigError.value = ''

  try {
    const response = await http.get('/api/ai/configs', {
      params: { type: 'embedding' }
    })
    embeddingConfigs.value = Array.isArray(response?.items)
      ? response.items
        .map((item) => ({
          aiId: String(item?.aiId || '').trim(),
          name: String(item?.name || item?.aiId || '').trim() || String(item?.aiId || '').trim()
        }))
        .filter((item) => item.aiId)
      : []

    if (selectedEmbeddingAiId.value && !embeddingConfigs.value.some((item) => item.aiId === selectedEmbeddingAiId.value)) {
      selectedEmbeddingAiId.value = ''
    }
  } catch (error) {
    embeddingConfigs.value = []
    embeddingConfigError.value = error instanceof Error ? error.message : '读取 Embedding 配置失败。'
  } finally {
    isLoadingEmbeddingConfigs.value = false
  }
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
  if (selectedCollectionId.value === collectionId) return
  selectedCollectionId.value = collectionId
  uploadError.value = ''
  uploadMessage.value = ''
  selectedFiles.value = []
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
    selectedCollectionId.value = response?.item?.collectionId || selectedCollectionId.value
    showCreateModal.value = false
    newCollectionName.value = ''
    newCollectionDescription.value = ''
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
      if (selectedEmbeddingAiId.value) {
        formData.append('embeddingAiId', selectedEmbeddingAiId.value)
      }
      formData.append('file', file)
      await http.post('/api/agent/rag/upload', formData)
      uploadedCount += 1
    }
    selectedFiles.value = []
    uploadMessage.value = `已入库 ${uploadedCount} 个文件。`
    showUploadModal.value = false
    await loadDocuments()
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : '上传入库失败。'
  } finally {
    isUploading.value = false
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
  height: 100%;
  min-height: 0;
}

.settings-rag__top {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 0;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.settings-rag__panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid #e7ebf3;
  border-radius: 22px;
  background: #ffffff;
  padding: 20px;
}

.settings-rag__panel--list {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.settings-rag__panel--documents {
  border-left: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.settings-rag h4,
.settings-rag p {
  margin: 0;
}

.settings-rag__panel-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.settings-rag__panel-head h4 {
  color: #171717;
  font-size: 1rem;
}

.settings-rag__panel-head span,
.settings-rag__empty {
  color: #7a869f;
}

.settings-rag__add-btn {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: #171717;
  color: #ffffff;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
}

.settings-rag__add-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.settings-rag__collection-list {
  display: grid;
  align-content: start;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
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
  transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.settings-rag__collection:hover {
  background: #f1f5f9;
  transform: translateX(2px);
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

.settings-rag__upload--modal {
  margin-top: 4px;
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

.settings-rag__primary:disabled {
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

.settings-rag__table {
  display: grid;
  min-height: 0;
  border: 1px solid #edf0f5;
  border-radius: 16px;
  overflow: auto;
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
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8fafc;
  color: #6b7280;
  font-weight: 700;
}

.settings-rag__row button {
  padding: 8px 12px;
  background: #f3f4f6;
  color: #374151;
}

.settings-rag-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.32);
  backdrop-filter: blur(8px);
}

.settings-rag-modal__dialog {
  display: grid;
  gap: 16px;
  width: min(460px, 100%);
  padding: 22px;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
}

.settings-rag-modal__dialog header,
.settings-rag-modal__dialog footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.settings-rag-modal__hint {
  margin: 0;
  color: #5d667a;
  line-height: 1.6;
}

.settings-rag-modal__dialog header p {
  margin: 0 0 6px;
  color: #7a869f;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-rag-modal__dialog h3 {
  margin: 0;
}

.settings-rag-modal__dialog header button {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: #f3f4f6;
  cursor: pointer;
  font-size: 1.2rem;
}

.settings-rag-modal__dialog label {
  display: grid;
  gap: 8px;
}

.settings-rag-modal__dialog label span {
  color: #5d667a;
  font-weight: 700;
}

.settings-rag-modal__dialog input,
.settings-rag-modal__dialog select,
.settings-rag-modal__dialog textarea {
  min-width: 0;
  border: 1px solid #d9dee9;
  border-radius: 14px;
  padding: 11px 13px;
  font: inherit;
  background: #ffffff;
}

.settings-rag-modal__secondary,
.settings-rag-modal__primary {
  border: 0;
  border-radius: 999px;
  padding: 11px 18px;
  cursor: pointer;
  font: inherit;
}

.settings-rag-modal__secondary {
  background: #f3f4f6;
  color: #374151;
}

.settings-rag-modal__primary {
  background: #171717;
  color: #ffffff;
}

.settings-rag-modal__primary:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.settings-rag-modal-enter-active,
.settings-rag-modal-leave-active {
  transition: opacity 0.36s ease, backdrop-filter 0.36s ease;
}

.settings-rag-modal-enter-active .settings-rag-modal__dialog,
.settings-rag-modal-leave-active .settings-rag-modal__dialog {
  transition: opacity 0.36s ease, transform 0.36s cubic-bezier(0.22, 1, 0.36, 1);
}

.settings-rag-modal-enter-from,
.settings-rag-modal-leave-to {
  opacity: 0;
  backdrop-filter: blur(0);
}

.settings-rag-modal-enter-from .settings-rag-modal__dialog,
.settings-rag-modal-leave-to .settings-rag-modal__dialog {
  opacity: 0;
  transform: translateY(14px) scale(0.97);
}

.settings-rag-modal-enter-to .settings-rag-modal__dialog,
.settings-rag-modal-leave-from .settings-rag-modal__dialog {
  opacity: 1;
  transform: translateY(0) scale(1);
}

@media (max-width: 1080px) {
  .settings-rag,
  .settings-rag__top,
  .settings-rag__row {
    grid-template-columns: 1fr;
  }

  .settings-rag__panel--list,
  .settings-rag__panel--documents {
    border: 1px solid #e7ebf3;
    border-radius: 22px;
  }
}
</style>
