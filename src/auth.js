import { AGENT_AUTH_CHANGED_EVENT, AGENT_AUTH_KEY, AGENT_USERNAME_KEY } from './storage.js'

const DEFAULT_AGENT_USERNAME = '访客'

function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function') {
    return storage
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage
  }

  return null
}

function normalizeValue(value) {
  return String(value ?? '').trim()
}

function notifyAgentAuthChanged() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(AGENT_AUTH_CHANGED_EVENT))
}

export function getAgentUsername({ storage, fallback = DEFAULT_AGENT_USERNAME } = {}) {
  const resolvedStorage = resolveStorage(storage)

  if (!resolvedStorage) {
    return fallback
  }

  return normalizeValue(resolvedStorage.getItem(AGENT_USERNAME_KEY)) || fallback
}

export function persistAgentAuthSession({
  storage,
  username,
  token,
  accessToken,
  refreshToken,
  authTokenKey,
  refreshTokenKey
} = {}) {
  const resolvedStorage = resolveStorage(storage)

  if (!resolvedStorage) {
    return
  }

  const normalizedAccessToken = normalizeValue(accessToken || token)
  const normalizedRefreshToken = normalizeValue(refreshToken)

  if (!normalizedAccessToken) {
    throw new Error('Agent auth session requires an access token.')
  }

  if (!normalizedRefreshToken) {
    throw new Error('Agent auth session requires a refresh token.')
  }

  resolvedStorage.setItem(AGENT_AUTH_KEY, 'true')
  resolvedStorage.setItem(
    AGENT_USERNAME_KEY,
    normalizeValue(username) || DEFAULT_AGENT_USERNAME
  )

  if (authTokenKey) {
    resolvedStorage.setItem(authTokenKey, normalizedAccessToken)
  }

  if (refreshTokenKey) {
    resolvedStorage.setItem(refreshTokenKey, normalizedRefreshToken)
  }

  notifyAgentAuthChanged()
}

export function clearAgentAuthSession({ storage, authTokenKey, refreshTokenKey } = {}) {
  const resolvedStorage = resolveStorage(storage)

  if (!resolvedStorage) {
    return
  }

  resolvedStorage.removeItem(AGENT_AUTH_KEY)
  resolvedStorage.removeItem(AGENT_USERNAME_KEY)

  if (authTokenKey) {
    resolvedStorage.removeItem(authTokenKey)
  }

  if (refreshTokenKey) {
    resolvedStorage.removeItem(refreshTokenKey)
  }

  notifyAgentAuthChanged()
}
