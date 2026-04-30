import axios from 'axios'
import { AGENT_AUTH_KEY, AGENT_USERNAME_KEY, AUTH_TOKEN_KEY } from './storage.js'

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

function clearAgentStoredAuth() {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.removeItem(AGENT_AUTH_KEY)
  localStorage.removeItem(AGENT_USERNAME_KEY)
  localStorage.removeItem(AUTH_TOKEN_KEY)
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

    const token = localStorage.getItem(AUTH_TOKEN_KEY)

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
  (error) => {
    if (axios.isAxiosError(error)) {
      if (
        error.response?.status === 401
        && !String(error.config?.url || '').includes('/api/login')
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
