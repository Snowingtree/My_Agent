<template>
  <section class="settings-skills">
    <aside class="settings-skills__sidebar">
      <div class="settings-skills__sidebar-head">
        <div>
          <p class="settings-skills__eyebrow">项目 Skills 目录</p>
          <h3>技能文件</h3>
        </div>
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
      </div>

      <p v-if="detailError" class="settings-skills__status is-error">{{ detailError }}</p>
      <p v-else-if="isLoadingDetail" class="settings-skills__status">正在读取技能说明...</p>
      <p v-else-if="!selectedSkillDetail" class="settings-skills__status">从左侧选择一个技能文件，查看它的说明文档。</p>

      <div
        v-else
        class="settings-skills__content"
      >
        <MdPreview
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
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import http from '../../http.js'

const skills = ref([])
const selectedSkillPath = ref('')
const selectedSkillDetail = ref(null)
const isLoadingList = ref(false)
const isLoadingDetail = ref(false)
const listError = ref('')
const detailError = ref('')
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
  selectedSkillPath.value = skillPath
  isLoadingDetail.value = true
  detailError.value = ''

  try {
    const response = await http.get('/api/agent/skill-file-detail', {
      params: { path: skillPath }
    })

    selectedSkillDetail.value = response?.item || null
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
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 18px;
  height: 100%;
  min-height: 400px;
}

.settings-skills__sidebar,
.settings-skills__detail {
  min-width: 0;
  border: 1px solid #e7ebf3;
  border-radius: 20px;
  background: #ffffff;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.settings-skills__sidebar-head,
.settings-skills__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 18px 14px;
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
  font-size: 1.1rem;
  font-weight: 700;
}

.settings-skills__list {
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 12px;
  overflow-y: auto;
}

.settings-skills__item {
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
  transition: background-color 160ms ease;
}

.settings-skills__item:hover {
  background: #f4f7fc;
}

.settings-skills__item.is-active {
  background: #eaf1ff;
  color: #214dba;
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

.settings-skills__detail {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.settings-skills__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 10px 0 0;
  color: #6e7890;
  font-size: 0.82rem;
}

.settings-skills__status {
  margin: 0;
  padding: 18px;
  color: #6b7280;
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
  color: #29455b;
  font-size: 0.98rem;
  line-height: 1.86;
  word-break: break-word;
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
  --md-theme-code-active-color: #036aca;
}

.settings-skills__content :deep(h1),
.settings-skills__content :deep(h2),
.settings-skills__content :deep(h3),
.settings-skills__content :deep(h4),
.settings-skills__content :deep(h5),
.settings-skills__content :deep(h6) {
  margin: 1.2em 0 0.45em;
  color: #12344e;
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
  color: #29455b;
}

.settings-skills__content :deep(li + li) {
  margin-top: 0.35rem;
}

.settings-skills__content :deep(strong) {
  color: #12344e;
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
  border-left: 4px solid rgba(45, 144, 255, 0.3);
  border-radius: 14px;
  background: rgba(45, 144, 255, 0.08);
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
  color: #29455b;
  line-height: 1.6;
  text-align: left;
  vertical-align: top;
}

.settings-skills__content :deep(th) {
  background: rgba(45, 144, 255, 0.08);
  color: #12344e;
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
  color: #2757bf;
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
