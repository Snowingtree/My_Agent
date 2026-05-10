import { normalizeTrimmedString } from './utils.js'

function normalizeBaseUrl(value) {
  return normalizeTrimmedString(value).replace(/\/$/, '')
}

function resolveEmbeddingEndpoint(baseURL) {
  const normalizedBaseUrl = normalizeBaseUrl(baseURL)

  if (!normalizedBaseUrl) {
    return ''
  }

  if (normalizedBaseUrl.endsWith('/embeddings')) {
    return normalizedBaseUrl
  }

  return `${normalizedBaseUrl}/embeddings`
}

function resolveDashScopeMultimodalEndpoint(baseURL) {
  const normalizedBaseUrl = normalizeBaseUrl(baseURL)

  if (!normalizedBaseUrl) {
    return 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'
  }

  if (normalizedBaseUrl.includes('/multimodal-embedding/multimodal-embedding')) {
    return normalizedBaseUrl
  }

  return `${normalizedBaseUrl}/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding`
}

function isDashScopeMultimodalModel(model) {
  const normalizedModel = normalizeTrimmedString(model).toLowerCase()
  return (
    normalizedModel.includes('embedding-vision')
    || normalizedModel.includes('vl-embedding')
    || normalizedModel === 'multimodal-embedding-v1'
  )
}

function normalizeEmbeddingVector(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

function parseEmbeddingPayload(payload) {
  const embedding = normalizeEmbeddingVector(payload?.data?.[0]?.embedding)

  if (embedding.length) {
    return embedding
  }

  const dashScopeEmbedding = normalizeEmbeddingVector(payload?.output?.embeddings?.[0]?.embedding)

  if (dashScopeEmbedding.length) {
    return dashScopeEmbedding
  }

  return normalizeEmbeddingVector(payload?.embedding)
}

export function createEmbeddingClient(embeddingConfig = {}) {
  const baseURL = normalizeBaseUrl(embeddingConfig.baseURL)
  const apiKey = normalizeTrimmedString(embeddingConfig.apiKey)
  const model = normalizeTrimmedString(embeddingConfig.model)
  const aiId = normalizeTrimmedString(embeddingConfig.aiId)
  const name = normalizeTrimmedString(embeddingConfig.name)
  const provider = normalizeTrimmedString(embeddingConfig.provider).toLowerCase() || 'auto'
  const timeoutMs = Number.isFinite(Number(embeddingConfig.timeoutMs))
    ? Math.max(1000, Number(embeddingConfig.timeoutMs))
    : 30000
  const expectedDimension = Number.parseInt(embeddingConfig.dimension, 10)
  const useDashScopeMultimodal = provider === 'dashscope-multimodal' || (provider === 'auto' && isDashScopeMultimodalModel(model))
  const enabled = Boolean((baseURL || useDashScopeMultimodal) && apiKey && model)

  function buildRequest() {
    if (useDashScopeMultimodal) {
      const parameters = {
        output_type: 'dense'
      }

      if (expectedDimension > 0) {
        parameters.dimension = expectedDimension
      }

      return {
        endpoint: resolveDashScopeMultimodalEndpoint(baseURL),
        body: {
          model,
          input: {
            contents: [
              {
                text: ''
              }
            ]
          },
          parameters
        }
      }
    }

    return {
      endpoint: resolveEmbeddingEndpoint(baseURL),
      body: {
        model,
        input: ''
      }
    }
  }

  async function embedText(input) {
    const normalizedInput = normalizeTrimmedString(input)

    if (!enabled) {
      throw new Error('RAG embedding model is not configured.')
    }

    if (!normalizedInput) {
      throw new Error('RAG embedding input is required.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const requestPayload = buildRequest()

      if (useDashScopeMultimodal) {
        requestPayload.body.input.contents[0].text = normalizedInput
      } else {
        requestPayload.body.input = normalizedInput
      }

      const response = await fetch(requestPayload.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload.body),
        signal: controller.signal
      })

      const responseText = await response.text()
      let payload = null

      try {
        payload = responseText ? JSON.parse(responseText) : null
      } catch {}

      if (!response.ok) {
        const errorMessage = normalizeTrimmedString(payload?.error?.message || payload?.message || responseText)
        throw new Error(`RAG embedding request failed with ${response.status}${errorMessage ? `: ${errorMessage}` : ''}`)
      }

      const embedding = parseEmbeddingPayload(payload)

      if (!embedding.length) {
        throw new Error('RAG embedding response did not contain an embedding vector.')
      }

      if (expectedDimension > 0 && embedding.length !== expectedDimension) {
        throw new Error(`RAG embedding dimension mismatch: expected ${expectedDimension}, got ${embedding.length}.`)
      }

      return embedding
    } finally {
      clearTimeout(timeout)
    }
  }

  function getStatus() {
    return {
      enabled,
      aiId,
      name,
      provider: useDashScopeMultimodal ? 'dashscope-multimodal' : 'openai-compatible',
      baseURL: useDashScopeMultimodal ? resolveDashScopeMultimodalEndpoint(baseURL) : (baseURL ? resolveEmbeddingEndpoint(baseURL) : ''),
      model,
      dimension: expectedDimension || null
    }
  }

  return {
    embedText,
    getStatus
  }
}
