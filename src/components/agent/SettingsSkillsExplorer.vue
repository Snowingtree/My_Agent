<template>
  <section class="settings-skills">
    <aside class="settings-skills__sidebar">
      <div class="settings-skills__sidebar-head">
        <div>
          <p class="settings-skills__eyebrow">项目 Skills 目录</p>
          <h3>技能包</h3>
        </div>
      </div>

      <p v-if="listError" class="settings-skills__status is-error">{{ listError }}</p>
      <p v-else-if="isLoadingList" class="settings-skills__status">正在读取技能包...</p>
      <p v-else-if="!skills.length" class="settings-skills__status">
        当前还没有上传任何技能包。你后续可以把包含 <code>SKILL.md</code> 的文件夹放进项目的
        <code>skills/</code> 目录。
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
            <span>{{ selectedSkillDetail.contentSource }}</span>
            <span>{{ selectedSkillDetail.updatedAt }}</span>
          </p>
        </div>
      </div>

      <p v-if="detailError" class="settings-skills__status is-error">{{ detailError }}</p>
      <p v-else-if="isLoadingDetail" class="settings-skills__status">正在读取技能说明...</p>
      <p v-else-if="!selectedSkillDetail" class="settings-skills__status">从左侧选择一个技能包，查看它的说明文档。</p>

      <article
        v-else
        class="settings-skills__content agent-markdown-content"
        v-html="renderedSkillContent"
      ></article>
    </section>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import http from '../../http.js'

const skills = ref([])
const selectedSkillPath = ref('')
const selectedSkillDetail = ref(null)
const isLoadingList = ref(false)
const isLoadingDetail = ref(false)
const listError = ref('')
const detailError = ref('')

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

const renderedSkillContent = computed(() => {
  return renderMarkdownHtml(selectedSkillDetail.value?.content || '')
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
    listError.value = error instanceof Error ? error.message : '读取技能包列表失败。'
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
  padding: 18px;
}

.settings-skills__content :deep(h1),
.settings-skills__content :deep(h2),
.settings-skills__content :deep(h3),
.settings-skills__content :deep(h4),
.settings-skills__content :deep(h5),
.settings-skills__content :deep(h6) {
  margin: 0 0 12px;
  color: #171717;
}

.settings-skills__content :deep(p),
.settings-skills__content :deep(ul),
.settings-skills__content :deep(ol) {
  margin: 0 0 12px;
  color: #30394b;
  line-height: 1.75;
}

.settings-skills__content :deep(code) {
  padding: 0.1em 0.35em;
  border-radius: 6px;
  background: #f3f5f8;
  font-family: Consolas, 'SFMono-Regular', Menlo, Monaco, monospace;
  font-size: 0.92em;
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
