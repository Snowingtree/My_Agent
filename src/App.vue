<template>
  <main v-if="!privateAppAvailable" class="auth-layout">
    <PrivateAccessLoadingOverlay :state="privateAppChecking ? 'checking' : 'denied'" />
  </main>

  <main v-else-if="authChecking" class="auth-layout">
    <PrivateAccessLoadingOverlay state="checking" />
  </main>

  <main v-else-if="isAuthenticated" class="agent-root">
    <AgentWorkspaceScreen :username="currentUsername" @logout="handleLogout" />
  </main>

  <main v-else class="auth-layout">
    <LoginForm
      :submitting="submitting"
      :server-error="serverError"
      brand-tag=""
      :title="agentTitle"
      copy=""
      @login="handleLogin"
    />
  </main>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import LoginForm from './components/LoginForm/LoginForm.vue'
import PrivateAccessLoadingOverlay from './components/PrivateAccessLoadingOverlay/PrivateAccessLoadingOverlay.vue'
import { usePrivateAppAccess } from './hooks/usePrivateAppAccess.js'
import { clearAgentAuthSession, clearAgentWorkspacePreferences, persistAgentAuthSession } from './auth.js'
import http from './http.js'
import { LEGACY_AUTH_TOKEN_KEY } from './storage.js'
import AgentWorkspaceScreen from './components/AgentWorkspaceScreen.vue'

const agentTitle = 'Agent'
const LEGACY_LOGIN_ENDPOINT = '/api/login'
const submitting = ref(false)
const serverError = ref('')
const { privateAppAvailable, privateAppChecking } = usePrivateAppAccess()
const authChecking = ref(false)
const isAuthenticated = ref(false)
const currentUsername = ref('')

let previousHtmlOverflow = ''
let previousBodyOverflow = ''
let isDocumentScrollLocked = false

function syncDocumentScrollLock(locked) {
  if (typeof document === 'undefined') {
    return
  }

  const { documentElement, body } = document

  if (locked) {
    if (isDocumentScrollLocked) {
      return
    }

    previousHtmlOverflow = documentElement.style.overflow
    previousBodyOverflow = body.style.overflow
    documentElement.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    isDocumentScrollLocked = true
    return
  }

  if (!isDocumentScrollLocked) {
    return
  }

  documentElement.style.overflow = previousHtmlOverflow
  body.style.overflow = previousBodyOverflow
  isDocumentScrollLocked = false
}

async function loginWithSharedBlogAuth(payload) {
  const response = await fetch(LEGACY_LOGIN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload),
    credentials: 'include'
  })
  const rawBody = await response.text()
  let body = null

  try {
    body = rawBody ? JSON.parse(rawBody) : null
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      typeof body?.message === 'string'
        ? body.message
        : typeof rawBody === 'string' && rawBody.trim() && !rawBody.trim().startsWith('<')
          ? rawBody.trim()
          : 'Login failed. Please try again.'
    throw new Error(message)
  }

  return body || {}
}

async function syncAuthSession() {
  if (!privateAppAvailable.value) {
    return
  }

  authChecking.value = true
  localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY)
  clearAgentWorkspacePreferences({ storage: localStorage })

  try {
    const data = await http.get('/api/auth/session')
    isAuthenticated.value = Boolean(data?.authenticated)
    currentUsername.value = isAuthenticated.value
      ? String(data?.user?.username || '').trim()
      : ''
  } catch {
    isAuthenticated.value = false
    currentUsername.value = ''
  } finally {
    authChecking.value = false
  }
}

async function handleLogin(payload) {
  serverError.value = ''
  submitting.value = true

  try {
    const data = await loginWithSharedBlogAuth(payload)
    const username = typeof data.user?.username === 'string' ? data.user.username : payload.username

    persistAgentAuthSession({
      storage: localStorage
    })

    currentUsername.value = String(username || '').trim()
    isAuthenticated.value = true
  } catch (error) {
    clearAgentAuthSession({
      storage: localStorage
    })
    serverError.value = error instanceof Error ? error.message : 'Login failed. Please try again.'
    currentUsername.value = ''
    isAuthenticated.value = false
  } finally {
    submitting.value = false
  }
}

async function handleLogout() {
  try {
    await http.post('/api/logout')
  } catch {
    // Local cleanup still matters if the network request fails or the cookie is already expired.
  }

  clearAgentAuthSession({
    storage: localStorage,
    clearPreferences: true
  })
  currentUsername.value = ''
  isAuthenticated.value = false
}

watch(isAuthenticated, (value) => {
  syncDocumentScrollLock(value)
}, { immediate: true })

watch(
  privateAppAvailable,
  (available) => {
    if (available) {
      void syncAuthSession()
      return
    }

    authChecking.value = false
    isAuthenticated.value = false
    currentUsername.value = ''
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  syncDocumentScrollLock(false)
})
</script>

<style scoped>
.agent-root {
  height: 100dvh;
  min-height: 100dvh;
  overflow: hidden;
}
</style>
