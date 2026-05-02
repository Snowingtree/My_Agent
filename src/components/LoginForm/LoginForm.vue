<template>
  <section class="auth-card">
    <div class="brand-block" :class="{ 'brand-block--compact': isCompactBrand }">
      <div class="brand-icon">
        <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="40" height="40" rx="12" stroke="#171717" stroke-width="2" fill="none" opacity="0.15" />
          <circle cx="17" cy="20" r="3" fill="#171717" opacity="0.7" />
          <circle cx="31" cy="20" r="3" fill="#171717" opacity="0.7" />
          <path d="M16 32 C20 36 28 36 32 32" stroke="#171717" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.6" />
          <line x1="24" y1="2" x2="24" y2="8" stroke="#171717" stroke-width="2" stroke-linecap="round" opacity="0.3" />
          <circle cx="24" cy="2" r="1.5" fill="#171717" opacity="0.4" />
        </svg>
      </div>

      <p v-if="brandTag" class="brand-tag">{{ brandTag }}</p>
      <h1>{{ title }}</h1>
      <p v-if="copy" class="brand-copy">{{ copy }}</p>

      <ul class="brand-features">
        <li>
          <span class="feature-dot"></span>
          <span><strong>智能对话</strong>支持多种 AI 模型</span>
        </li>
        <li>
          <span class="feature-dot"></span>
          <span><strong>代码助手</strong>读写、调试与自动化</span>
        </li>
        <li>
          <span class="feature-dot"></span>
          <span><strong>任务规划</strong>自动拆解复杂流程</span>
        </li>
        <li>
          <span class="feature-dot"></span>
          <span><strong>工具集成</strong>MCP 扩展能力接入</span>
        </li>
      </ul>
    </div>

    <form class="login-form" @submit.prevent="submitLogin">
      <div class="login-form-header">
        <p class="login-form-eyebrow">欢迎回来</p>
        <h2>登录 Agent</h2>
        <p class="login-form-sub">请输入账号信息以继续</p>
      </div>

      <label class="field">
        <span>用户名</span>
        <input
          v-model="form.username"
          placeholder="请输入用户名"
          autocomplete="username"
          :disabled="submitting"
          @input="handleInput"
        />
      </label>

      <label class="field">
        <span>密码</span>
        <input
          v-model="form.password"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
          :disabled="submitting"
          @input="handleInput"
        />
      </label>

      <p v-if="displayError" class="form-error">{{ displayError }}</p>

      <div class="login-actions">
        <button class="primary-btn login-btn" type="submit" :disabled="submitting">
          {{ submitting ? '登录中...' : '登录' }}
        </button>
        <a class="secondary-btn login-home-link" :href="homeHrefValue">
          返回首页
        </a>
      </div>
    </form>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { getPublicAppBaseUrl } from '../../utils/privateAccess.js'

const props = defineProps({
  submitting: {
    type: Boolean,
    default: false
  },
  brandTag: {
    type: String,
    default: 'Single Page App'
  },
  title: {
    type: String,
    default: '登录后查看内容'
  },
  copy: {
    type: String,
    default: ''
  },
  serverError: {
    type: String,
    default: ''
  },
  homeHref: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['login'])

const form = reactive({
  username: '',
  password: ''
})
const validationError = ref('')
const dismissServerError = ref(false)

const displayError = computed(() => {
  if (validationError.value) {
    return validationError.value
  }

  return dismissServerError.value ? '' : props.serverError
})
const isCompactBrand = computed(() => !props.brandTag && !props.copy)
const homeHrefValue = computed(() => props.homeHref || `${getPublicAppBaseUrl()}/`)

watch(
  () => props.serverError,
  () => {
    dismissServerError.value = false
  }
)

function handleInput() {
  validationError.value = ''
  dismissServerError.value = true
}

function submitLogin() {
  const username = form.username.trim()

  if (!username || !form.password) {
    validationError.value = '用户名和密码不能为空'
    return
  }

  validationError.value = ''
  dismissServerError.value = false

  emit('login', {
    username,
    password: form.password
  })
}
</script>

<style scoped>
.auth-card {
  width: min(960px, 100%);
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 0;
  padding: 0;
  border-radius: 24px;
  overflow: hidden;
  animation: cardEnter 0.7s ease-out;
}

@keyframes cardEnter {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.brand-block {
  padding: 40px 36px;
  border-radius: 0;
  color: #171717;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  overflow: hidden;
  border-right: 1px solid #ebebeb;
  animation: brandEnter 0.6s ease-out 0.1s both;
}

@keyframes brandEnter {
  from { opacity: 0; transform: translateX(-16px); }
  to { opacity: 1; transform: translateX(0); }
}

.brand-block::before {
  content: '';
  position: absolute;
  top: -20%;
  right: -15%;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 0, 0, 0.03), transparent 70%);
  pointer-events: none;
}

.brand-block--compact {
  align-items: center;
  text-align: center;
}

.brand-icon {
  width: 48px;
  height: 48px;
  margin-bottom: 20px;
}

.brand-icon svg {
  width: 100%;
  height: 100%;
}

.brand-tag {
  margin: 0 0 8px;
  color: #9b9b9b;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  position: relative;
}

.brand-copy {
  max-width: 360px;
  margin: 14px 0 0;
  color: #8a8a8a;
  font-size: 0.96rem;
  line-height: 1.7;
  position: relative;
}

.brand-block h1 {
  max-width: none;
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 3.2rem);
  line-height: 1.1;
  position: relative;
}

.brand-block--compact h1 {
  max-width: none;
}

.brand-features {
  list-style: none;
  margin: 28px 0 0;
  padding: 0;
  display: grid;
  gap: 12px;
  position: relative;
}

.brand-features li {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #6b6b6b;
  font-size: 0.88rem;
  line-height: 1.5;
}

.brand-features li strong {
  color: #171717;
  font-weight: 600;
  margin-right: 6px;
}

.feature-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c0c0c0;
  flex-shrink: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
  padding: 40px 36px;
  animation: formEnter 0.6s ease-out 0.2s both;
}

@keyframes formEnter {
  from { opacity: 0; transform: translateX(16px); }
  to { opacity: 1; transform: translateX(0); }
}

.login-form-header {
  margin-bottom: 4px;
}

.login-form-eyebrow {
  margin: 0 0 6px;
  color: #9b9b9b;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.login-form-header h2 {
  margin: 0;
  color: #171717;
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.2;
}

.login-form-sub {
  margin: 6px 0 0;
  color: #8a8a8a;
  font-size: 0.92rem;
}

.login-actions {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.login-actions .login-btn,
.login-actions .login-home-link {
  flex: 1;
  width: auto;
}

.login-home-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}

@media (max-width: 720px) {
  .auth-card {
    grid-template-columns: 1fr;
    border-radius: 24px;
  }

  .brand-block {
    padding: 32px 24px;
    border-radius: 24px 24px 0 0;
  }

  .brand-features {
    margin-top: 20px;
  }

  .login-form {
    padding: 32px 24px;
  }

  .login-actions {
    display: grid;
  }
}
</style>
