import { AGENT_AUTH_KEY, AGENT_USERNAME_KEY } from './storage.js'

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
  authTokenKey
} = {}) {
  const resolvedStorage = resolveStorage(storage)

  if (!resolvedStorage) {
    return
  }

  const normalizedToken = normalizeValue(token)

  if (!normalizedToken) {
    throw new Error('Agent auth session requires a token.')
  }

  resolvedStorage.setItem(AGENT_AUTH_KEY, 'true')
  resolvedStorage.setItem(
    AGENT_USERNAME_KEY,
    normalizeValue(username) || DEFAULT_AGENT_USERNAME
  )

  if (authTokenKey) {
    resolvedStorage.setItem(authTokenKey, normalizedToken)
  }
}

export function clearAgentAuthSession({ storage, authTokenKey } = {}) {
  const resolvedStorage = resolveStorage(storage)

  if (!resolvedStorage) {
    return
  }

  resolvedStorage.removeItem(AGENT_AUTH_KEY)
  resolvedStorage.removeItem(AGENT_USERNAME_KEY)

  if (authTokenKey) {
    resolvedStorage.removeItem(authTokenKey)
  }
}
