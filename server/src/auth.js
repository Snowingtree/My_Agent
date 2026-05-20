import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

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

export function createAuthToken({ username, secret, ttlMs, type = '', extraPayload = {} }) {
  const issuedAt = Date.now()
  const payload = {
    ...(extraPayload && typeof extraPayload === 'object' && !Array.isArray(extraPayload) ? extraPayload : {}),
    sub: username,
    iat: issuedAt,
    exp: issuedAt + ttlMs
  }

  if (type) {
    payload.typ = type
  }

  const payloadSegment = base64urlEncode(JSON.stringify(payload))
  const signatureSegment = signPayload(payloadSegment, secret)

  return `${payloadSegment}.${signatureSegment}`
}

function verifyTokenPayloadType(payload, expectedType) {
  const normalizedExpectedType = String(expectedType || '').trim()

  if (!normalizedExpectedType) {
    return true
  }

  const actualType = String(payload?.typ || '').trim()

  if (!actualType && normalizedExpectedType === 'access') {
    return true
  }

  return actualType === normalizedExpectedType
}

function verifyLegacyAuthToken(token, secret, options = {}) {
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

  return verifyTokenPayloadType(payload, options.expectedType) ? payload : null
}

function verifyJwtAuthToken(token, secret, options = {}) {
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

  return verifyTokenPayloadType(payload, options.expectedType) ? payload : null
}

export function verifyAuthToken(token, secret, options = {}) {
  const normalizedToken = String(token || '').trim()

  if (!normalizedToken) {
    return null
  }

  const segments = normalizedToken.split('.')

  if (segments.length === 2) {
    return verifyLegacyAuthToken(normalizedToken, secret, options)
  }

  if (segments.length === 3) {
    return verifyJwtAuthToken(normalizedToken, secret, options)
  }

  return null
}

export function readBearerToken(headers) {
  const authorization = String(headers.authorization || '').trim()

  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return ''
  }

  return authorization.slice(7).trim()
}
