<template>
  <section class="settings-skills">
    <aside class="settings-skills__sidebar">
      <div class="settings-skills__sidebar-head">
        <div>
          <h3>技能文件</h3>
        </div>
        <button
          type="button"
          class="settings-skills__add-button"
          aria-label="新增 Skill"
          title="新增 Skill"
          @click="openCreateSkillDialog"
        >
          +
        </button>
      </div>

      <p v-if="listError" class="settings-skills__status is-error">{{ listError }}</p>
      <p v-else-if="isLoadingList" class="settings-skills__status">正在读取技能文件...</p>
      <p v-else-if="!skills.length" class="settings-skills__status">
        当前还没有技能文件。把 <code>.md</code> 文件直接放到 <code>skills/</code> 目录即可。
      </p>

      <div v-else class="settings-skills__list">
        <button
          v-for="item in skills"
          :key="item.skillPath"
          type="button"
          class="settings-skills__item"
          :class="{ 'is-active': item.skillPath === selectedSkillPath }"
          @click="selectSkill(item.skillPath)"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ item.skillPath }}</span>
        </button>
      </div>
    </aside>

    <section class="settings-skills__detail">
      <div class="settings-skills__detail-head">
        <div v-if="selectedSkillDetail">
          <p class="settings-skills__eyebrow">技能说明</p>
          <h3>{{ selectedSkillDetail.title }}</h3>
          <p class="settings-skills__meta">
            <span>{{ selectedSkillDetail.skillPath }}</span>
            <span>{{ selectedSkillDetail.updatedAt }}</span>
          </p>
        </div>

        <div v-if="selectedSkillDetail" class="settings-skills__detail-actions">
          <template v-if="isEditingSkill">
            <button
              type="button"
              class="settings-skills__action-button"
              :disabled="isSavingSkill"
              @click="cancelEditSkill"
            >
              取消
            </button>
            <button
              type="button"
              class="settings-skills__action-button is-primary"
              :disabled="isSavingSkill || !hasUnsavedSkillEdit"
              @click="saveSkillFile"
            >
              {{ isSavingSkill ? '保存中...' : '保存' }}
            </button>
          </template>
          <button
            v-else
            type="button"
            class="settings-skills__action-button is-primary"
            @click="beginEditSkill"
          >
            编辑
          </button>
        </div>
      </div>

      <p v-if="detailError" class="settings-skills__status is-error">{{ detailError }}</p>
      <p v-else-if="isLoadingDetail" class="settings-skills__status">正在读取技能说明...</p>
      <p v-else-if="!selectedSkillDetail" class="settings-skills__status">从左侧选择一个技能文件，查看它的说明文档。</p>

      <div
        v-else
        class="settings-skills__content"
        :class="{ 'is-editing': isEditingSkill }"
      >
        <MdEditor
          v-if="isEditingSkill"
          v-model="skillDraftContent"
          class="settings-skills__markdown-editor"
          editor-id="settings-skills-markdown-editor"
          language="zh-CN"
          theme="light"
          preview-theme="smart-blue"
          code-theme="github"
          :preview="false"
          :html-preview="false"
          :no-mermaid="true"
          :no-katex="true"
          :no-echarts="true"
          :no-upload-img="true"
          :no-prettier="true"
          :md-heading-id="resolveMarkdownHeadingId"
          :sanitize="sanitizeSkillMarkdownHtml"
          :style="{ height: '100%' }"
        />

        <MdPreview
          v-else
          class="settings-skills__markdown-preview"
          editor-id="settings-skills-markdown-preview"
          language="zh-CN"
          theme="light"
          preview-theme="smart-blue"
          code-theme="github"
          :model-value="normalizedSkillContent"
          :md-heading-id="resolveMarkdownHeadingId"
          :sanitize="sanitizeSkillMarkdownHtml"
          :no-mermaid="true"
          :no-katex="true"
          :no-echarts="true"
        />
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="isCreateSkillDialogVisible"
        class="settings-skills__dialog"
        @click.self="closeCreateSkillDialog"
      >
        <section
          class="settings-skills__dialog-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-skills-create-title"
        >
          <div class="settings-skills__dialog-head">
            <div>
              <p class="settings-skills__eyebrow">新增 Skill</p>
              <h3 id="settings-skills-create-title">创建技能文件</h3>
            </div>
            <button
              type="button"
              class="settings-skills__dialog-close"
              aria-label="关闭"
              @click="closeCreateSkillDialog"
            >
              ×
            </button>
          </div>

          <form class="settings-skills__dialog-body" @submit.prevent="createSkillFile">
            <label class="settings-skills__field">
              <span>Skill ID</span>
              <input
                v-model.trim="createSkillForm.name"
                type="text"
                placeholder="例如 code_review"
                autocomplete="off"
                required
              >
            </label>

            <label class="settings-skills__field">
              <span>显示名称</span>
              <input
                v-model.trim="createSkillForm.title"
                type="text"
                placeholder="例如 代码审查"
                autocomplete="off"
              >
            </label>

            <label class="settings-skills__field">
              <span>描述</span>
              <input
                v-model.trim="createSkillForm.description"
                type="text"
                placeholder="简单说明这个 Skill 适合什么任务"
                autocomplete="off"
              >
            </label>

            <div class="settings-skills__field is-wide">
              <span>初始说明 Markdown</span>
              <MdEditor
                v-model="createSkillForm.body"
                class="settings-skills__create-editor"
                editor-id="settings-skills-create-markdown-editor"
                language="zh-CN"
                theme="light"
                preview-theme="smart-blue"
                code-theme="github"
                placeholder="写下 Skill 的适用场景、执行流程和输出要求"
                :preview="false"
                :html-preview="false"
                :no-mermaid="true"
                :no-katex="true"
                :no-echarts="true"
                :no-upload-img="true"
                :no-prettier="true"
                :md-heading-id="resolveMarkdownHeadingId"
                :sanitize="sanitizeSkillMarkdownHtml"
                :style="{ height: '100%' }"
              />
            </div>

            <p v-if="createSkillError" class="settings-skills__dialog-error">{{ createSkillError }}</p>

            <div class="settings-skills__dialog-actions">
              <button
                type="button"
                class="settings-skills__action-button"
                :disabled="isCreatingSkill"
                @click="closeCreateSkillDialog"
              >
                取消
              </button>
              <button
                type="submit"
                class="settings-skills__action-button is-primary"
                :disabled="isCreatingSkill"
              >
                {{ isCreatingSkill ? '创建中...' : '创建' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { MdEditor, MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import http from '../../http.js'

const skills = ref([])
const selectedSkillPath = ref('')
const selectedSkillDetail = ref(null)
const isLoadingList = ref(false)
const isLoadingDetail = ref(false)
const listError = ref('')
const detailError = ref('')
const isEditingSkill = ref(false)
const isSavingSkill = ref(false)
const skillDraftContent = ref('')
const isCreateSkillDialogVisible = ref(false)
const isCreatingSkill = ref(false)
const createSkillError = ref('')
const createSkillForm = ref({
  name: '',
  title: '',
  description: '',
  body: ''
})
const FRONTMATTER_PATTERN = /^(?:\uFEFF)?(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1\r?\n?/
const ZERO_WIDTH_MARK_PATTERN = /[\u200B-\u200D\u2060\uFEFF]/g
const HARD_SPACE_PATTERN = /[\u00A0\u202F]/g

function normalizeMarkdownSource(markdown) {
  if (!markdown) {
    return ''
  }

  return String(markdown)
    .replace(/^\uFEFF/, '')
    .replace(FRONTMATTER_PATTERN, '')
    .replace(ZERO_WIDTH_MARK_PATTERN, '')
    .replace(HARD_SPACE_PATTERN, ' ')
}

function buildMarkdownHeadingId(index) {
  return `skill-heading-${index}`
}

function resolveMarkdownHeadingId({ index }) {
  return buildMarkdownHeadingId(index)
}

function isAbsoluteUrl(value) {
  return /^(?:[a-z]+:)?\/\//i.test(String(value || ''))
}

function sanitizeSkillMarkdownHtml(html) {
  if (!html || typeof document === 'undefined') {
    return html
  }

  const wrapper = document.createElement('div')
  wrapper.innerHTML = String(html)

  wrapper.querySelectorAll('img[src]').forEach((element) => {
    element.setAttribute('loading', 'lazy')
  })

  wrapper.querySelectorAll('a[href]').forEach((element) => {
    const href = element.getAttribute('href') || ''

    if (isAbsoluteUrl(href)) {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noreferrer noopener')
    }
  })

  return wrapper.innerHTML
}

const normalizedSkillContent = computed(() => {
  return normalizeMarkdownSource(selectedSkillDetail.value?.content || '')
})

const hasUnsavedSkillEdit = computed(() => {
  return skillDraftContent.value !== String(selectedSkillDetail.value?.content || '')
})

const createSkillDefaultBody = `# 新 Skill

## 适用场景

- 

## 执行流程

1. 

## 输出要求

- 
`

function normalizeSkillName(value) {
  return String(value || '')
    .trim()
    .replace(/\.md$/i, '')
}

function normalizeMetadataValue(value) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function resetCreateSkillForm() {
  createSkillForm.value = {
    name: '',
    title: '',
    description: '',
    body: createSkillDefaultBody
  }
  createSkillError.value = ''
}

function buildCreateSkillContent(skillName) {
  const title = normalizeMetadataValue(createSkillForm.value.title) || skillName
  const description = normalizeMetadataValue(createSkillForm.value.description)
  const body = String(createSkillForm.value.body || '').trim() || `# ${title}

## 适用场景

- 

## 执行要求

- 
`
  const metadataLines = [
    `name: ${skillName}`,
    `title: ${title}`
  ]

  if (description) {
    metadataLines.push(`description: ${description}`)
  }

  return [...metadataLines, '', body].join('\n')
}

function openCreateSkillDialog() {
  if (
    isEditingSkill.value
    && hasUnsavedSkillEdit.value
    && typeof window !== 'undefined'
    && !window.confirm('当前技能说明有未保存修改，打开新增窗口会退出编辑，确定继续吗？')
  ) {
    return
  }

  isEditingSkill.value = false
  skillDraftContent.value = String(selectedSkillDetail.value?.content || '')
  resetCreateSkillForm()
  isCreateSkillDialogVisible.value = true
}

function closeCreateSkillDialog() {
  if (isCreatingSkill.value) {
    return
  }

  isCreateSkillDialogVisible.value = false
  resetCreateSkillForm()
}

async function createSkillFile() {
  if (isCreatingSkill.value) {
    return
  }

  const skillName = normalizeSkillName(createSkillForm.value.name)

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(skillName)) {
    createSkillError.value = 'Skill ID 只能使用字母、数字、短横线或下划线，并且必须以字母或数字开头。'
    return
  }

  isCreatingSkill.value = true
  createSkillError.value = ''

  try {
    const response = await http.post('/api/agent/skill-files', {
      fileName: `${skillName}.md`,
      content: buildCreateSkillContent(skillName)
    })
    const nextItem = response?.item || null

    if (!nextItem?.skillPath) {
      throw new Error('创建成功但服务端没有返回 Skill 文件信息。')
    }

    const listResponse = await http.get('/api/agent/skill-files')
    skills.value = Array.isArray(listResponse?.items) ? listResponse.items : []
    isCreateSkillDialogVisible.value = false
    resetCreateSkillForm()
    await selectSkill(nextItem.skillPath)
  } catch (error) {
    createSkillError.value = error instanceof Error ? error.message : '创建 Skill 失败。'
  } finally {
    isCreatingSkill.value = false
  }
}

function syncSkillListItem(nextItem) {
  if (!nextItem?.skillPath) {
    return
  }

  skills.value = skills.value.map((item) => (
    item.skillPath === nextItem.skillPath
      ? {
          ...item,
          name: nextItem.name,
          title: nextItem.title,
          description: nextItem.description,
          sizeBytes: nextItem.sizeBytes,
          updatedAt: nextItem.updatedAt
        }
      : item
  ))
}

function beginEditSkill() {
  skillDraftContent.value = String(selectedSkillDetail.value?.content || '')
  isEditingSkill.value = true
  detailError.value = ''
}

function cancelEditSkill() {
  if (
    hasUnsavedSkillEdit.value
    && typeof window !== 'undefined'
    && !window.confirm('当前技能说明有未保存修改，确定取消编辑吗？')
  ) {
    return
  }

  skillDraftContent.value = String(selectedSkillDetail.value?.content || '')
  isEditingSkill.value = false
  detailError.value = ''
}

async function saveSkillFile() {
  if (!selectedSkillDetail.value?.skillPath || isSavingSkill.value) {
    return
  }

  isSavingSkill.value = true
  detailError.value = ''

  try {
    const response = await http.put('/api/agent/skill-file-detail', {
      path: selectedSkillDetail.value.skillPath,
      content: skillDraftContent.value
    })
    const nextItem = response?.item || null

    if (nextItem) {
      selectedSkillDetail.value = nextItem
      selectedSkillPath.value = nextItem.skillPath
      skillDraftContent.value = String(nextItem.content || '')
      syncSkillListItem(nextItem)
    }

    isEditingSkill.value = false
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '保存技能说明失败。'
  } finally {
    isSavingSkill.value = false
  }
}

async function loadSkillList() {
  isLoadingList.value = true
  listError.value = ''

  try {
    const response = await http.get('/api/agent/skill-files')
    skills.value = Array.isArray(response?.items) ? response.items : []

    if (!skills.value.length) {
      selectedSkillPath.value = ''
      selectedSkillDetail.value = null
      return
    }

    if (!selectedSkillPath.value || !skills.value.some((item) => item.skillPath === selectedSkillPath.value)) {
      await selectSkill(skills.value[0].skillPath)
    }
  } catch (error) {
    listError.value = error instanceof Error ? error.message : '读取技能文件列表失败。'
    skills.value = []
    selectedSkillPath.value = ''
    selectedSkillDetail.value = null
  } finally {
    isLoadingList.value = false
  }
}

async function selectSkill(skillPath) {
  if (isEditingSkill.value && selectedSkillPath.value === skillPath) {
    return
  }

  if (
    isEditingSkill.value
    && hasUnsavedSkillEdit.value
    && selectedSkillPath.value !== skillPath
    && typeof window !== 'undefined'
    && !window.confirm('当前技能说明有未保存修改，确定切换文件吗？')
  ) {
    return
  }

  selectedSkillPath.value = skillPath
  isLoadingDetail.value = true
  detailError.value = ''
  isEditingSkill.value = false
  skillDraftContent.value = ''

  try {
    const response = await http.get('/api/agent/skill-file-detail', {
      params: { path: skillPath }
    })

    selectedSkillDetail.value = response?.item || null
    skillDraftContent.value = String(selectedSkillDetail.value?.content || '')
  } catch (error) {
    selectedSkillDetail.value = null
    detailError.value = error instanceof Error ? error.message : '读取技能说明失败。'
  } finally {
    isLoadingDetail.value = false
  }
}

onMounted(() => {
  void loadSkillList()
})
</script>

<style scoped>
.settings-skills {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 0;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.settings-skills__sidebar,
.settings-skills__detail {
  min-width: 0;
  border: 1px solid #e7ebf3;
  border-radius: 22px;
  background: #ffffff;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.settings-skills__sidebar {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.settings-skills__detail {
  border-left: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.settings-skills__sidebar-head,
.settings-skills__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid #eef1f6;
}

.settings-skills__eyebrow {
  margin: 0 0 6px;
  color: #7a869f;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.settings-skills__sidebar-head h3,
.settings-skills__detail-head h3 {
  margin: 0;
  color: #171717;
  font-size: 1rem;
  font-weight: 700;
}

.settings-skills__add-button {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: #171717;
  color: #ffffff;
  cursor: pointer;
  font: inherit;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1;
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.settings-skills__add-button:hover {
  transform: translateY(-1px);
  opacity: 0.88;
}

.settings-skills__list {
  display: grid;
  gap: 8px;
  align-content: start;
  padding: 16px 20px 20px;
  overflow-y: auto;
}

.settings-skills__item {
  display: grid;
  gap: 4px;
  width: 100%;
  border: 0;
  border-radius: 14px;
  background: #f8fafc;
  padding: 12px 14px;
  color: #171717;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.settings-skills__item:hover {
  background: #f1f5f9;
  transform: translateX(2px);
}

.settings-skills__item.is-active {
  background: #171717;
  color: #ffffff;
}

.settings-skills__item strong {
  font-size: 0.94rem;
  font-weight: 700;
}

.settings-skills__item span {
  color: #75819a;
  font-size: 0.78rem;
  line-height: 1.45;
  word-break: break-word;
}

.settings-skills__item.is-active span {
  color: rgba(255, 255, 255, 0.72);
}

.settings-skills__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 10px 0 0;
  color: #6e7890;
  font-size: 0.82rem;
}

.settings-skills__detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.settings-skills__action-button {
  min-width: 64px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: #f3f4f6;
  color: #374151;
  cursor: pointer;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 700;
  transition: background-color 160ms ease, color 160ms ease, opacity 160ms ease;
}

.settings-skills__action-button:hover:not(:disabled) {
  background: #e5e7eb;
}

.settings-skills__action-button.is-primary {
  background: #171717;
  color: #ffffff;
}

.settings-skills__action-button.is-primary:hover:not(:disabled) {
  background: #000000;
}

.settings-skills__action-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.settings-skills__dialog {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.32);
  backdrop-filter: blur(8px);
}

.settings-skills__dialog-panel {
  width: min(940px, 100%);
  height: min(820px, calc(100vh - 48px));
  max-height: calc(100vh - 48px);
  overflow: hidden;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.settings-skills__dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 22px 16px;
  border-bottom: 0;
}

.settings-skills__dialog-head h3 {
  margin: 0;
  color: #171717;
  font-size: 1.08rem;
}

.settings-skills__dialog-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: #f3f4f6;
  color: #374151;
  cursor: pointer;
  font: inherit;
  font-size: 1.25rem;
  line-height: 1;
}

.settings-skills__dialog-close:hover {
  background: #e5e7eb;
}

.settings-skills__dialog-body {
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-rows: auto auto auto minmax(280px, 1fr) auto auto;
  gap: 14px;
  padding: 0 22px 22px;
}

.settings-skills__field {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  color: #5d667a;
  font-size: 0.88rem;
  font-weight: 700;
}

.settings-skills__field.is-wide {
  min-height: 0;
  grid-template-columns: 1fr;
  align-items: stretch;
  gap: 8px;
}

.settings-skills__field input,
.settings-skills__field textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d9dee9;
  border-radius: 14px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-weight: 500;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.settings-skills__field input {
  height: 42px;
  padding: 0 13px;
}

.settings-skills__field textarea {
  height: 100%;
  min-height: 300px;
  resize: vertical;
  padding: 10px 12px;
  font-family: Consolas, 'SFMono-Regular', Menlo, Monaco, monospace;
  line-height: 1.65;
}

.settings-skills__field input:focus,
.settings-skills__field textarea:focus {
  border-color: #171717;
  box-shadow: 0 0 0 3px rgba(23, 23, 23, 0.09);
}

.settings-skills__create-editor {
  min-height: 300px;
  overflow: hidden;
  border: 1px solid #d9dee9;
  border-radius: 14px;
}

.settings-skills__create-editor :deep(.md-editor-toolbar-wrapper),
.settings-skills__create-editor :deep(.md-editor-footer) {
  background: #f8fafc;
}

.settings-skills__create-editor :deep(.cm-editor),
.settings-skills__create-editor :deep(.md-editor-preview-wrapper) {
  background: #ffffff;
}

.settings-skills__dialog-error {
  margin: 0;
  border-radius: 10px;
  background: #fff4f2;
  color: #b33d34;
  padding: 10px 12px;
  font-size: 0.88rem;
  line-height: 1.5;
}

.settings-skills__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}

@media (max-width: 720px) {
  .settings-skills__dialog {
    padding: 14px;
  }

  .settings-skills__dialog-panel {
    height: min(760px, calc(100vh - 28px));
  }

  .settings-skills__field {
    grid-template-columns: 1fr;
    align-items: stretch;
    gap: 8px;
  }
}

.settings-skills__status {
  margin: 0;
  padding: 18px;
  color: #7a869f;
  font-size: 0.94rem;
  line-height: 1.6;
}

.settings-skills__status.is-error {
  color: #b33d34;
}

.settings-skills__content {
  min-height: 0;
  overflow: auto;
  padding: 22px;
  color: #374151;
  font-size: 0.98rem;
  line-height: 1.86;
  word-break: break-word;
}

.settings-skills__content.is-editing {
  padding: 0;
  overflow: hidden;
}

.settings-skills__markdown-editor {
  height: 100%;
  border: 0;
}

.settings-skills__markdown-editor :deep(.md-editor-input-wrapper) {
  background: #ffffff;
}

.settings-skills__markdown-editor :deep(.cm-editor) {
  font-size: 0.92rem;
}

.settings-skills__markdown-editor :deep(.cm-content) {
  font-family: Consolas, 'SFMono-Regular', Menlo, Monaco, monospace;
}

.settings-skills__markdown-preview {
  background: transparent;
}

.settings-skills__markdown-preview :deep(.md-editor-preview-wrapper) {
  padding: 0;
  background: transparent;
}

.settings-skills__markdown-preview :deep(.md-editor-preview) {
  --md-theme-code-block-color: #1f2937;
  --md-theme-code-block-bg-color: #ffffff;
  --md-theme-code-before-bg-color: #f8fafc;
  --md-theme-code-active-color: #171717;
}

.settings-skills__content :deep(h1),
.settings-skills__content :deep(h2),
.settings-skills__content :deep(h3),
.settings-skills__content :deep(h4),
.settings-skills__content :deep(h5),
.settings-skills__content :deep(h6) {
  margin: 1.2em 0 0.45em;
  color: #171717;
  line-height: 1.2;
}

.settings-skills__content :deep(h1:first-child),
.settings-skills__content :deep(h2:first-child),
.settings-skills__content :deep(h3:first-child),
.settings-skills__content :deep(h4:first-child),
.settings-skills__content :deep(h5:first-child),
.settings-skills__content :deep(h6:first-child) {
  margin-top: 0;
}

.settings-skills__content :deep(p),
.settings-skills__content :deep(ul),
.settings-skills__content :deep(ol),
.settings-skills__content :deep(blockquote),
.settings-skills__content :deep(pre) {
  margin: 0 0 1rem;
}

.settings-skills__content :deep(ul),
.settings-skills__content :deep(ol) {
  padding-left: 1.5rem;
  color: #374151;
}

.settings-skills__content :deep(li + li) {
  margin-top: 0.35rem;
}

.settings-skills__content :deep(strong) {
  color: #171717;
  font-weight: 700;
}

.settings-skills__content :deep(del) {
  color: #667085;
}

.settings-skills__content :deep(code) {
  padding: 0.16em 0.38em;
  border-radius: 8px;
  background: rgba(18, 52, 78, 0.08);
  font-family: Consolas, 'SFMono-Regular', Menlo, Monaco, monospace;
  font-size: 0.92em;
}

.settings-skills__content :deep(blockquote) {
  border-left: 4px solid #d1d5db;
  border-radius: 14px;
  background: #f8fafc;
  color: #475467;
  line-height: 1.75;
  padding: 12px 16px;
}

.settings-skills__content :deep(img) {
  display: block;
  max-width: 100%;
  margin: 1rem 0;
  border-radius: 16px;
  box-shadow: 0 16px 30px rgba(18, 52, 78, 0.12);
}

.settings-skills__content :deep(hr) {
  margin: 1.5rem 0;
  border: 0;
  border-top: 1px solid rgba(18, 52, 78, 0.14);
}

.settings-skills__content :deep(pre) {
  margin: 0 0 1rem;
  overflow: auto;
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  color: #1f2937;
  font-family: Consolas, 'SFMono-Regular', Menlo, Monaco, monospace;
  font-size: 0.84rem;
  line-height: 1.7;
}

.settings-skills__content :deep(.md-editor-code) {
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
}

.settings-skills__content :deep(.md-editor-code .md-editor-code-head) {
  border-bottom: 1px solid #e5e7eb;
  background: #f8fafc;
  color: #475467;
}

.settings-skills__content :deep(.md-editor-code pre) {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: #ffffff;
}

.settings-skills__content :deep(pre code) {
  display: block;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
  white-space: pre;
}

.settings-skills__content :deep(.md-editor-code pre code),
.settings-skills__content :deep(.md-editor-code pre code .md-editor-code-block) {
  background: #ffffff;
  color: #1f2937;
}

.settings-skills__content :deep(.md-editor-code span[rn-wrapper] > span::before) {
  color: #94a3b8;
}

.settings-skills__content :deep(table) {
  display: block;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  margin: 0 0 1rem;
  border-collapse: collapse;
  border-spacing: 0;
  background: #ffffff;
  font-size: 0.88rem;
}

.settings-skills__content :deep(th),
.settings-skills__content :deep(td) {
  border: 1px solid rgba(18, 52, 78, 0.12);
  padding: 0.72rem 0.88rem;
  color: #374151;
  line-height: 1.6;
  text-align: left;
  vertical-align: top;
}

.settings-skills__content :deep(th) {
  background: #f8fafc;
  color: #171717;
  font-weight: 800;
}

.settings-skills__content :deep(.settings-skills__task-item) {
  list-style: none;
}

.settings-skills__content :deep(.settings-skills__task-paragraph) {
  display: inline-flex;
  align-items: flex-start;
  gap: 0.65rem;
}

.settings-skills__content :deep(.settings-skills__task-checkbox) {
  width: 1rem;
  height: 1rem;
  margin: 0.28rem 0 0;
  flex-shrink: 0;
  accent-color: #2d90ff;
  pointer-events: none;
}

.settings-skills__content :deep(a) {
  color: #171717;
  text-decoration: none;
}

.settings-skills__content :deep(a:hover) {
  text-decoration: underline;
}

@media (max-width: 1080px) {
  .settings-skills {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr;
  }
}
</style>
