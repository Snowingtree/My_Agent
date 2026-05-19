import axios from 'axios'
import {
  AGENT_AUTH_CHANGED_EVENT,
  AGENT_AUTH_KEY,
  AGENT_USERNAME_KEY,
  AUTH_REFRESH_TOKEN_KEY,
  AUTH_TOKEN_KEY
} from './storage.js'

const EXPLICIT_API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '')
const EXPLICIT_PRIVATE_APP_BASE_URL = String(import.meta.env.VITE_PRIVATE_APP_BASE_URL || '')
  .trim()
  .replace(/\/$/, '')

function resolveApiBaseUrl() {
  if (EXPLICIT_API_BASE_URL) {
    return EXPLICIT_API_BASE_URL
  }

  if (typeof window === 'undefined') {
    return ''
  }

  if (EXPLICIT_PRIVATE_APP_BASE_URL && window.location.pathname.startsWith('/agent')) {
    return EXPLICIT_PRIVATE_APP_BASE_URL
  }

  return ''
}

export function buildApiUrl(pathname) {
  const normalizedPath = String(pathname || '').trim()
  const baseURL = resolveApiBaseUrl()

  if (!normalizedPath) {
    return baseURL || ''
  }

  if (!baseURL) {
    return normalizedPath
  }

  return `${baseURL}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`
}

function getStoredToken(storageKey) {
  if (typeof localStorage === 'undefined') {
    return ''
  }

  return String(localStorage.getItem(storageKey) || '').trim()
}

function writeStoredAuthTokens({ accessToken, refreshToken }) {
  if (typeof localStorage === 'undefined') {
    return
  }

  const normalizedAccessToken = String(accessToken || '').trim()
  const normalizedRefreshToken = String(refreshToken || '').trim()

  if (normalizedAccessToken) {
    localStorage.setItem(AUTH_TOKEN_KEY, normalizedAccessToken)
  }

  if (normalizedRefreshToken) {
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, normalizedRefreshToken)
  }

  localStorage.setItem(AGENT_AUTH_KEY, 'true')

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AGENT_AUTH_CHANGED_EVENT))
  }
}

function clearAgentStoredAuth() {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.removeItem(AGENT_AUTH_KEY)
  localStorage.removeItem(AGENT_USERNAME_KEY)
  localStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AGENT_AUTH_CHANGED_EVENT))
  }
}

function isAuthRequest(url, pathname) {
  return String(url || '').includes(pathname)
}

function isLoginRequest(url) {
  return isAuthRequest(url, '/api/agent/login')
}

let refreshAccessTokenPromise = null

export async function refreshAgentAccessToken() {
  if (refreshAccessTokenPromise) {
    return refreshAccessTokenPromise
  }

  refreshAccessTokenPromise = (async () => {
    const refreshToken = getStoredToken(AUTH_REFRESH_TOKEN_KEY)

    if (!refreshToken) {
      throw new Error('Refresh token is missing.')
    }

    const response = await axios.post(
      buildApiUrl('/api/auth/refresh'),
      {
        refresh_token: refreshToken
      },
      {
        timeout: 10000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      }
    )

    const data = response.data || {}
    const accessToken = String(data.access_token || '').trim()
    const nextRefreshToken = String(data.refresh_token || '').trim()

    if (!accessToken || !nextRefreshToken) {
      throw new Error('Refresh response did not include tokens.')
    }

    writeStoredAuthTokens({
      accessToken,
      refreshToken: nextRefreshToken
    })

    return accessToken
  })()

  try {
    return await refreshAccessTokenPromise
  } finally {
    refreshAccessTokenPromise = null
  }
}

function createHttpError(error) {
  const responseData = error.response?.data
  const responseMessage =
    typeof responseData === 'string'
      ? responseData.trim() && !responseData.trim().startsWith('<')
        ? responseData.trim()
        : ''
      : responseData?.message
  const message =
    responseMessage ||
    (error.response?.status === 403
      ? 'Request was blocked with 403. Check whether the deployed site is forwarding /api to the Node service, or set VITE_API_BASE_URL to the real backend origin.'
      : '') ||
    (error.response?.status === 500
      ? 'Server returned 500. Check the Node service logs for the exact auth error.'
      : error.message || 'Request failed')
  const normalizedError = new Error(message)

  normalizedError.name = 'HttpError'
  normalizedError.status = error.response?.status
  normalizedError.data = error.response?.data

  return normalizedError
}

const http = axios.create({
  timeout: 10000
})

http.interceptors.request.use(
  (config) => {
    if (!config.baseURL) {
      config.baseURL = resolveApiBaseUrl()
    }

    const headers = axios.AxiosHeaders.from(config.headers)

    headers.set('Accept', 'application/json')

    const token = getStoredToken(AUTH_TOKEN_KEY)

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const hasRequestBody = config.data !== undefined && config.data !== null

    if (hasRequestBody && !(config.data instanceof FormData) && !headers.getContentType()) {
      headers.set('Content-Type', 'application/json')
    }

    config.headers = headers
    return config
  },
  (error) => Promise.reject(error)
)

http.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    if (axios.isAxiosError(error)) {
      const originalConfig = error.config || {}
      const requestUrl = String(originalConfig.url || '')

      if (
        error.response?.status === 401
        && !originalConfig.__isRetryAfterRefresh
        && !isLoginRequest(requestUrl)
        && !isAuthRequest(requestUrl, '/api/auth/refresh')
      ) {
        try {
          const nextAccessToken = await refreshAgentAccessToken()
          const headers = axios.AxiosHeaders.from(originalConfig.headers)
          headers.set('Authorization', `Bearer ${nextAccessToken}`)
          originalConfig.headers = headers
          originalConfig.__isRetryAfterRefresh = true
          return http.request(originalConfig)
        } catch {
          clearAgentStoredAuth()

          if (typeof window !== 'undefined') {
            const nextUrl = new URL('/agent/', window.location.origin).toString()

            if (window.location.href !== nextUrl) {
              window.location.assign(nextUrl)
            }
          }
        }
      } else if (
        error.response?.status === 401
        && !isLoginRequest(requestUrl)
      ) {
        clearAgentStoredAuth()

        if (typeof window !== 'undefined') {
          const nextUrl = new URL('/agent/', window.location.origin).toString()

          if (window.location.href !== nextUrl) {
            window.location.assign(nextUrl)
          }
        }
      }

      return Promise.reject(createHttpError(error))
    }

    return Promise.reject(error instanceof Error ? error : new Error('Request failed'))
  }
)

export default http
