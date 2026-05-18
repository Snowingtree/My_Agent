import {
  AGENT_ACTIVE_SESSION_KEY,
  AGENT_AI_ID_KEY,
  AGENT_AI_MODEL_KEY,
  AGENT_AUTH_CHANGED_EVENT,
  AGENT_AUTH_KEY,
  AGENT_EMBEDDING_AI_ID_KEY,
  AGENT_EPHEMERAL_ATTACHMENT_MARKERS_KEY,
  AGENT_LARK_CHAT_ID_KEY,
  AGENT_MCP_SERVER_IDS_KEY,
  AGENT_RAG_COLLECTION_IDS_KEY,
  AGENT_SKILL_ID_KEY,
  AGENT_USERNAME_KEY,
  LEGACY_AGENT_RAG_COLLECTION_ID_KEY,
  LEGACY_AUTH_TOKEN_KEY
} from './storage.js'

function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function') {
    return storage
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage
  }

  return null
}

function notifyAgentAuthChanged() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(AGENT_AUTH_CHANGED_EVENT))
}

function removeStorageKeys(storage, keys) {
  if (!storage || !Array.isArray(keys)) {
    return
  }

  keys.forEach((key) => {
    if (key) {
      storage.removeItem(key)
    }
  })
}

export function clearAgentWorkspacePreferences({ storage } = {}) {
  const resolvedStorage = resolveStorage(storage)

  removeStorageKeys(resolvedStorage, [
    AGENT_AUTH_KEY,
    AGENT_USERNAME_KEY,
    AGENT_ACTIVE_SESSION_KEY,
    AGENT_AI_ID_KEY,
    AGENT_AI_MODEL_KEY,
    AGENT_SKILL_ID_KEY,
    AGENT_MCP_SERVER_IDS_KEY,
    AGENT_LARK_CHAT_ID_KEY,
    AGENT_RAG_COLLECTION_IDS_KEY,
    AGENT_EMBEDDING_AI_ID_KEY,
    AGENT_EPHEMERAL_ATTACHMENT_MARKERS_KEY,
    LEGACY_AGENT_RAG_COLLECTION_ID_KEY,
    LEGACY_AUTH_TOKEN_KEY
  ])

  if (typeof sessionStorage !== 'undefined') {
    removeStorageKeys(sessionStorage, [
      AGENT_MCP_SERVER_IDS_KEY,
      AGENT_LARK_CHAT_ID_KEY
    ])
  }
}

export function persistAgentAuthSession({ storage } = {}) {
  const resolvedStorage = resolveStorage(storage)

  removeStorageKeys(resolvedStorage, [
    AGENT_AUTH_KEY,
    AGENT_USERNAME_KEY,
    LEGACY_AUTH_TOKEN_KEY
  ])

  notifyAgentAuthChanged()
}

export function clearAgentAuthSession({ storage, clearPreferences = false } = {}) {
  const resolvedStorage = resolveStorage(storage)

  removeStorageKeys(resolvedStorage, [
    AGENT_AUTH_KEY,
    AGENT_USERNAME_KEY,
    LEGACY_AUTH_TOKEN_KEY
  ])

  if (clearPreferences) {
    clearAgentWorkspacePreferences({ storage: resolvedStorage })
  }

  notifyAgentAuthChanged()
}
