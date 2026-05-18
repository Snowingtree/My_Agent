const DEFAULT_PRIVATE_APP_BASE_URL = (
  import.meta.env.VITE_PRIVATE_APP_BASE_URL || 'http://100.73.19.92'
).replace(/\/$/, '')
const DEFAULT_PUBLIC_APP_BASE_URL = (
  import.meta.env.VITE_PUBLIC_APP_BASE_URL || 'http://www.wmzh.online'
).replace(/\/$/, '')
const PRIVATE_APP_ALLOWED_HOSTS = String(import.meta.env.VITE_PRIVATE_APP_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean)
let runtimePrivateAppAccess = false

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase()
}

function isLocalDevelopmentHost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

function isTailscaleIpv4(hostname) {
  const segments = hostname.split('.')

  if (segments.length !== 4 || segments.some((segment) => !/^\d+$/.test(segment))) {
    return false
  }

  const [firstOctet, secondOctet] = segments.map((segment) => Number.parseInt(segment, 10))

  return firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127
}

function isPrivateAppHost(hostname = typeof window !== 'undefined' ? window.location.hostname : '') {
  const normalizedHostname = normalizeHostname(hostname)

  if (!normalizedHostname) {
    return false
  }

  return (
    isLocalDevelopmentHost(normalizedHostname)
    || isTailscaleIpv4(normalizedHostname)
    || normalizedHostname.endsWith('.ts.net')
    || PRIVATE_APP_ALLOWED_HOSTS.includes(normalizedHostname)
  )
}

function getPrivateAppBaseUrl() {
  if (typeof window !== 'undefined' && isPrivateAppHost()) {
    return window.location.origin.replace(/\/$/, '')
  }

  return DEFAULT_PRIVATE_APP_BASE_URL
}

function getPublicAppBaseUrl() {
  if (typeof window !== 'undefined' && !isPrivateAppHost()) {
    return window.location.origin.replace(/\/$/, '')
  }

  return DEFAULT_PUBLIC_APP_BASE_URL
}

function setRuntimePrivateAppAccess(value) {
  runtimePrivateAppAccess = Boolean(value)
}

function hasRuntimePrivateAppAccess() {
  return runtimePrivateAppAccess
}

function canUsePrivateAppOrigin() {
  return isPrivateAppHost() || hasRuntimePrivateAppAccess()
}

function resolvePrivateAppUrl(path = '/') {
  const normalizedPath = String(path || '/')
  const pathWithLeadingSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`

  return `${getPrivateAppBaseUrl()}${pathWithLeadingSlash}`
}

async function detectPrivateAppReachability(timeoutMs = 1500) {
  if (typeof window === 'undefined') {
    return false
  }

  if (isPrivateAppHost()) {
    setRuntimePrivateAppAccess(true)
    return true
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    await fetch(`${getPrivateAppBaseUrl()}/?ts=${Date.now()}`, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller?.signal
    })
    setRuntimePrivateAppAccess(true)
    return true
  } catch {
    setRuntimePrivateAppAccess(false)
    return false
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }
}

export {
  canUsePrivateAppOrigin,
  detectPrivateAppReachability,
  getPrivateAppBaseUrl,
  getPublicAppBaseUrl,
  hasRuntimePrivateAppAccess,
  isPrivateAppHost,
  resolvePrivateAppUrl,
  setRuntimePrivateAppAccess
}
