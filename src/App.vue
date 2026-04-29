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
import { ref } from 'vue'
import LoginForm from './components/LoginForm/LoginForm.vue'
import PrivateAccessLoadingOverlay from './components/PrivateAccessLoadingOverlay/PrivateAccessLoadingOverlay.vue'
import { usePrivateAppAccess } from './hooks/usePrivateAppAccess.js'
import { clearAgentAuthSession, persistAgentAuthSession } from './auth.js'
import http from './http.js'
import { AGENT_AUTH_KEY, AUTH_TOKEN_KEY } from './storage.js'
import AgentWorkspaceScreen from './components/AgentWorkspaceScreen.vue'

const agentTitle = 'Agent'
const LEGACY_LOGIN_ENDPOINT = '/api/login'
const submitting = ref(false)
const serverError = ref('')
const { privateAppAvailable, privateAppChecking } = usePrivateAppAccess()
const isAuthenticated = ref(readAgentAuthState())

function readAgentAuthState() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)

  return (
    localStorage.getItem(AGENT_AUTH_KEY) === 'true'
    && typeof token === 'string'
    && token.trim().length > 0
  )
}

function refreshAuthState() {
  isAuthenticated.value = readAgentAuthState()
}

async function loginWithSharedBlogAuth(payload) {
  const response = await fetch(LEGACY_LOGIN_ENDPOINT, {
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

async function handleLogin(payload) {
  serverError.value = ''
  submitting.value = true

  try {
    const data = await loginWithSharedBlogAuth(payload)
    const username = typeof data.user?.username === 'string' ? data.user.username : payload.username
    const token = typeof data.token === 'string' ? data.token : ''

    if (!token) {
      throw new Error('Login succeeded but the server did not return an auth token.')
    }

    persistAgentAuthSession({
      storage: localStorage,
      username,
      token,
      authTokenKey: AUTH_TOKEN_KEY
    })

    refreshAuthState()
  } catch (error) {
    clearAgentAuthSession({
      storage: localStorage,
      authTokenKey: AUTH_TOKEN_KEY
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
    authTokenKey: AUTH_TOKEN_KEY
  })
  refreshAuthState()
}
</script>

<style scoped>
.agent-root {
  min-height: 100dvh;
}
</style>
