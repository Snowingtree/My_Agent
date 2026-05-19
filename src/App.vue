<template>
  <main v-if="!privateAppAvailable" class="auth-layout">
    <PrivateAccessLoadingOverlay :state="privateAppChecking ? 'checking' : 'denied'" />
  </main>

  <main v-else-if="isAuthenticated" class="agent-root">
    <AgentWorkspaceScreen @logout="handleLogout" />
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
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LoginForm from './components/LoginForm/LoginForm.vue'
import PrivateAccessLoadingOverlay from './components/PrivateAccessLoadingOverlay/PrivateAccessLoadingOverlay.vue'
import { usePrivateAppAccess } from './hooks/usePrivateAppAccess.js'
import { clearAgentAuthSession, persistAgentAuthSession } from './auth.js'
import { buildApiUrl } from './http.js'
import { AGENT_AUTH_CHANGED_EVENT, AGENT_AUTH_KEY, AUTH_REFRESH_TOKEN_KEY, AUTH_TOKEN_KEY } from './storage.js'
import AgentWorkspaceScreen from './components/AgentWorkspaceScreen.vue'

const agentTitle = 'Agent'
const LOGIN_ENDPOINT = '/api/agent/login'
const submitting = ref(false)
const serverError = ref('')
const { privateAppAvailable, privateAppChecking } = usePrivateAppAccess()
const isAuthenticated = ref(readAgentAuthState())

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
  const response = await fetch(buildApiUrl(LOGIN_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
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

function readAgentAuthState() {
  const accessToken = localStorage.getItem(AUTH_TOKEN_KEY)
  const refreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)

  return (
    localStorage.getItem(AGENT_AUTH_KEY) === 'true'
    && typeof accessToken === 'string'
    && accessToken.trim().length > 0
    && typeof refreshToken === 'string'
    && refreshToken.trim().length > 0
  )
}

function refreshAuthState() {
  isAuthenticated.value = readAgentAuthState()
}

function handleAuthStateChanged() {
  refreshAuthState()
}

function handleStorageChanged(event) {
  const changedKey = String(event?.key || '').trim()

  if (!changedKey || [AGENT_AUTH_KEY, AUTH_TOKEN_KEY, AUTH_REFRESH_TOKEN_KEY].includes(changedKey)) {
    refreshAuthState()
  }
}

async function handleLogin(payload) {
  serverError.value = ''
  submitting.value = true

  try {
    const data = await loginWithSharedBlogAuth(payload)
    const username = typeof data.user?.username === 'string' ? data.user.username : payload.username
    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : ''

    if (!accessToken || !refreshToken) {
      throw new Error('Login succeeded but the server did not return access_token and refresh_token.')
    }

    persistAgentAuthSession({
      storage: localStorage,
      username,
      accessToken,
      refreshToken,
      authTokenKey: AUTH_TOKEN_KEY,
      refreshTokenKey: AUTH_REFRESH_TOKEN_KEY
    })

    refreshAuthState()
  } catch (error) {
    clearAgentAuthSession({
      storage: localStorage,
      authTokenKey: AUTH_TOKEN_KEY,
      refreshTokenKey: AUTH_REFRESH_TOKEN_KEY
    })
    serverError.value = error instanceof Error ? error.message : 'Login failed. Please try again.'
    refreshAuthState()
  } finally {
    submitting.value = false
  }
}

function handleLogout() {
  clearAgentAuthSession({
    storage: localStorage,
    authTokenKey: AUTH_TOKEN_KEY,
    refreshTokenKey: AUTH_REFRESH_TOKEN_KEY
  })
  refreshAuthState()
}

watch(isAuthenticated, (value) => {
  syncDocumentScrollLock(value)
}, { immediate: true })

onMounted(() => {
  syncDocumentScrollLock(isAuthenticated.value)

  if (typeof window !== 'undefined') {
    window.addEventListener(AGENT_AUTH_CHANGED_EVENT, handleAuthStateChanged)
    window.addEventListener('storage', handleStorageChanged)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener(AGENT_AUTH_CHANGED_EVENT, handleAuthStateChanged)
    window.removeEventListener('storage', handleStorageChanged)
  }

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
