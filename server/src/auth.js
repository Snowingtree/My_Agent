import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const AUTH_COOKIE_NAME = 'magent_auth_token'

function base64urlEncode(value) {
  return Buffer.from(value).toString('base64url')
}

function base64urlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function signPayload(payloadSegment, secret) {
  return createHmac('sha256', secret).update(payloadSegment).digest('base64url')
}

function hashValue(value) {
  return createHash('sha256').update(String(value)).digest()
}

export function safeCompare(left, right) {
  const leftHash = hashValue(left)
  const rightHash = hashValue(right)

  return timingSafeEqual(leftHash, rightHash)
}

export function createAuthToken({ username, secret, ttlMs }) {
  const issuedAt = Date.now()
  const payload = {
    sub: username,
    iat: issuedAt,
    exp: issuedAt + ttlMs
  }
  const payloadSegment = base64urlEncode(JSON.stringify(payload))
  const signatureSegment = signPayload(payloadSegment, secret)

  return `${payloadSegment}.${signatureSegment}`
}

function verifyLegacyAuthToken(token, secret) {
  const [payloadSegment, signatureSegment] = token.split('.')

  if (!payloadSegment || !signatureSegment) {
    return null
  }

  const expectedSignature = signPayload(payloadSegment, secret)

  if (!safeCompare(signatureSegment, expectedSignature)) {
    return null
  }

  const payload = parseJson(base64urlDecode(payloadSegment))

  if (!payload?.sub || !payload?.exp || Number(payload.exp) <= Date.now()) {
    return null
  }

  return payload
}

function verifyJwtAuthToken(token, secret) {
  const [headerSegment, payloadSegment, signatureSegment] = token.split('.')

  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return null
  }

  const header = parseJson(base64urlDecode(headerSegment))

  if (String(header?.alg || '').toUpperCase() !== 'HS256') {
    return null
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest('base64url')

  if (!safeCompare(signatureSegment, expectedSignature)) {
    return null
  }

  const payload = parseJson(base64urlDecode(payloadSegment))
  const expSeconds = Number(payload?.exp)

  if (!payload?.sub || !Number.isFinite(expSeconds) || expSeconds <= Math.floor(Date.now() / 1000)) {
    return null
  }

  return payload
}

export function verifyAuthToken(token, secret) {
  const normalizedToken = String(token || '').trim()

  if (!normalizedToken) {
    return null
  }

  const segments = normalizedToken.split('.')

  if (segments.length === 2) {
    return verifyLegacyAuthToken(normalizedToken, secret)
  }

  if (segments.length === 3) {
    return verifyJwtAuthToken(normalizedToken, secret)
  }

  return null
}

export function readCookieValue(headers, name) {
  const normalizedName = String(name || '').trim()
  const cookieHeader = String(headers?.cookie || '').trim()

  if (!normalizedName || !cookieHeader) {
    return ''
  }

  const prefix = `${normalizedName}=`
  const pair = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))

  if (!pair) {
    return ''
  }

  try {
    return decodeURIComponent(pair.slice(prefix.length))
  } catch {
    return pair.slice(prefix.length)
  }
}

export function readAuthCookie(headers) {
  return readCookieValue(headers, AUTH_COOKIE_NAME)
}

function createCookieHeader(name, value, attributes = []) {
  return [
    `${name}=${encodeURIComponent(String(value || ''))}`,
    ...attributes.filter(Boolean)
  ].join('; ')
}

export function createAuthCookieHeader(token, { ttlMs, secure = false } = {}) {
  const maxAgeSeconds = Math.max(1, Math.floor(Number(ttlMs || 0) / 1000))

  return createCookieHeader(AUTH_COOKIE_NAME, token, [
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : ''
  ])
}

export function createExpiredAuthCookieHeader({ secure = false } = {}) {
  return createCookieHeader(AUTH_COOKIE_NAME, '', [
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : ''
  ])
}

export function readBearerToken(headers) {
  const authorization = String(headers.authorization || '').trim()

  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return ''
  }

  return authorization.slice(7).trim()
}
