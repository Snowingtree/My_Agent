<template>
  <section class="auth-card">
    <div class="brand-block" :class="{ 'brand-block--compact': isCompactBrand }">
      <p v-if="brandTag" class="brand-tag">{{ brandTag }}</p>
      <h1>{{ title }}</h1>
      <p v-if="copy" class="brand-copy">
        {{ copy }}
      </p>
    </div>

    <form class="login-form" @submit.prevent="submitLogin">
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
