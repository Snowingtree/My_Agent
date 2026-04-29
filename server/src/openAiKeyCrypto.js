import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const OPENAI_KEY_ENCRYPTION_PREFIX = 'enc:v1'

function normalizeEnvValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function getEncryptionSecret(valueOrEnv = process.env) {
  const secret =
    typeof valueOrEnv === 'string'
      ? normalizeEnvValue(valueOrEnv)
      : normalizeEnvValue(valueOrEnv.OPENAI_KEY_ENCRYPTION_SECRET)

  if (!secret) {
    throw new Error(
      'OPENAI_KEY_ENCRYPTION_SECRET is required to encrypt or decrypt stored OpenAI API keys.'
    )
  }

  return secret
}

function deriveEncryptionKey(secret) {
  return createHash('sha256').update(secret).digest()
}

function isEncryptedOpenAiApiKey(value) {
  return normalizeEnvValue(value).startsWith(`${OPENAI_KEY_ENCRYPTION_PREFIX}:`)
}

export function encryptOpenAiApiKey(value, env = process.env) {
  const normalizedValue = normalizeEnvValue(value)

  if (!normalizedValue) {
    throw new Error('OpenAI API key cannot be empty.')
  }

  const secret = getEncryptionSecret(env)
  const key = deriveEncryptionKey(secret)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(normalizedValue, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    OPENAI_KEY_ENCRYPTION_PREFIX,
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex')
  ].join(':')
}

export function decryptStoredOpenAiApiKey(value, env = process.env) {
  const normalizedValue = normalizeEnvValue(value)

  if (!normalizedValue) {
    return ''
  }

  if (!isEncryptedOpenAiApiKey(normalizedValue)) {
    return normalizedValue
  }

  const secret = getEncryptionSecret(env)
  const parts = normalizedValue.split(':')

  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== OPENAI_KEY_ENCRYPTION_PREFIX) {
    throw new Error('Stored OpenAI API key has an invalid encrypted format.')
  }

  const [, , ivHex, authTagHex, encryptedHex] = parts

  if (
    !/^[0-9a-f]+$/i.test(ivHex)
    || !/^[0-9a-f]+$/i.test(authTagHex)
    || !/^[0-9a-f]+$/i.test(encryptedHex)
  ) {
    throw new Error('Stored OpenAI API key has an invalid encrypted payload.')
  }

  try {
    const key = deriveEncryptionKey(secret)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final()
    ])

    return decrypted.toString('utf8').trim()
  } catch {
    throw new Error(
      'Failed to decrypt stored OpenAI API key. Check OPENAI_KEY_ENCRYPTION_SECRET and encrypted values.'
    )
  }
}
