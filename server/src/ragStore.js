import pg from 'pg'
import { createId, normalizeTrimmedString } from './utils.js'

const { Pool } = pg

function normalizePositiveInteger(value, fallbackValue) {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue
}

function assertSafeVectorDimension(value) {
  const dimension = normalizePositiveInteger(value, 1024)

  if (dimension < 1 || dimension > 16384) {
    throw new Error('RAG embedding dimension must be between 1 and 16384.')
  }

  return dimension
}

function createDisabledStatus(reason = '') {
  return {
    enabled: false,
    ready: false,
    reason: reason || 'RAG database is not configured.'
  }
}

const DEFAULT_COLLECTION_ID = 'default'

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeLimit(value, fallbackValue) {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? Math.min(parsedValue, 50)
    : fallbackValue
}

function extractRagSearchTerms(query) {
  const normalizedQuery = normalizeTrimmedString(query)

  if (!normalizedQuery) {
    return []
  }

  const terms = new Set()

  for (const match of normalizedQuery.matchAll(/[A-Za-z0-9_+-]{2,}/g)) {
    terms.add(match[0])
  }

  for (const match of normalizedQuery.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const segment = match[0]
    terms.add(segment)

    for (let size = 2; size <= Math.min(4, segment.length); size += 1) {
      for (let index = 0; index <= segment.length - size; index += 1) {
        terms.add(segment.slice(index, index + size))
      }
    }
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, '')

  if (compactQuery.length >= 2 && compactQuery.length <= 80) {
    terms.add(compactQuery)
  }

  return [...terms]
    .map((item) => normalizeTrimmedString(item))
    .filter((item) => item.length >= 2)
    .slice(0, 32)
}

function formatVectorLiteral(embedding) {
  if (!Array.isArray(embedding) || !embedding.length) {
    return null
  }

  return `[${embedding.map((item) => {
    const value = Number(item)
    return Number.isFinite(value) ? String(value) : '0'
  }).join(',')}]`
}

function splitTextIntoChunks(content, {
  maxChars = 1200,
  overlapChars = 160
} = {}) {
  const normalizedContent = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  if (!normalizedContent) {
    return []
  }

  const safeMaxChars = Math.max(300, Math.min(normalizePositiveInteger(maxChars, 1200), 8000))
  const safeOverlapChars = Math.max(0, Math.min(normalizePositiveInteger(overlapChars, 160), Math.floor(safeMaxChars / 2)))
  const paragraphs = normalizedContent
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
  const chunks = []
  let currentChunk = ''

  function pushCurrentChunk() {
    const normalizedChunk = currentChunk.trim()

    if (normalizedChunk) {
      chunks.push(normalizedChunk)
    }

    currentChunk = ''
  }

  for (const paragraph of paragraphs.length ? paragraphs : [normalizedContent]) {
    if (paragraph.length > safeMaxChars) {
      pushCurrentChunk()

      for (let start = 0; start < paragraph.length; start += safeMaxChars - safeOverlapChars) {
        const slice = paragraph.slice(start, start + safeMaxChars).trim()

        if (slice) {
          chunks.push(slice)
        }

        if (start + safeMaxChars >= paragraph.length) {
          break
        }
      }

      continue
    }

    const nextChunk = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph

    if (nextChunk.length > safeMaxChars) {
      pushCurrentChunk()
      currentChunk = paragraph
    } else {
      currentChunk = nextChunk
    }
  }

  pushCurrentChunk()

  if (!safeOverlapChars || chunks.length <= 1) {
    return chunks
  }

  return chunks.map((chunk, index) => {
    if (index === 0) {
      return chunk
    }

    const previousTail = chunks[index - 1].slice(-safeOverlapChars).trim()
    return previousTail ? `${previousTail}\n\n${chunk}` : chunk
  })
}

export function createRagStore(ragConfig = {}, {
  embeddingProvider = null
} = {}) {
  const enabled = Boolean(ragConfig.enabled)
  const databaseUrl = normalizeTrimmedString(ragConfig.databaseUrl)
  const embeddingDimension = assertSafeVectorDimension(ragConfig.embeddingDimension)
  const maxSearchResults = normalizeLimit(ragConfig.maxSearchResults, 6)
  const chunkMaxChars = normalizePositiveInteger(ragConfig.chunkMaxChars, 1200)
  const chunkOverlapChars = normalizePositiveInteger(ragConfig.chunkOverlapChars, 160)
  let pool = null
  let initialized = false
  let initializePromise = null
  let lastError = ''

  function getEmbeddingStatus() {
    if (!embeddingProvider || typeof embeddingProvider.getStatus !== 'function') {
      return {
        enabled: false,
        model: '',
        dimension: embeddingDimension
      }
    }

    return embeddingProvider.getStatus()
  }

  async function embedChunkContent(content) {
    if (!embeddingProvider || typeof embeddingProvider.embedText !== 'function') {
      return null
    }

    const status = getEmbeddingStatus()

    if (!status.enabled) {
      return null
    }

    return formatVectorLiteral(await embeddingProvider.embedText(content))
  }

  function ensurePool() {
    if (!enabled || !databaseUrl) {
      throw new Error('RAG database is not configured.')
    }

    if (!pool) {
      pool = new Pool({
        connectionString: databaseUrl,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      })
    }

    return pool
  }

  async function initialize() {
    if (!enabled || !databaseUrl) {
      return createDisabledStatus()
    }

    if (initialized) {
      return getStatus()
    }

    if (initializePromise) {
      return initializePromise
    }

    initializePromise = (async () => {
      const client = await ensurePool().connect()

      try {
        await client.query('BEGIN')
        await client.query('CREATE EXTENSION IF NOT EXISTS vector')
        await client.query(`
          CREATE TABLE IF NOT EXISTS rag_collections (
            collection_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `)
        await client.query(`
          CREATE TABLE IF NOT EXISTS rag_documents (
            document_id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL DEFAULT 'default',
            title TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'manual',
            source_path TEXT NOT NULL DEFAULT '',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `)
        await client.query('ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS collection_id TEXT NOT NULL DEFAULT \'default\'')
        await client.query(`
          INSERT INTO rag_collections (collection_id, name, description, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (collection_id) DO NOTHING
        `, [DEFAULT_COLLECTION_ID, '默认知识库', '全局默认知识库'])
        await client.query(`
          CREATE TABLE IF NOT EXISTS rag_chunks (
            chunk_id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES rag_documents(document_id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            embedding vector(${embeddingDimension}),
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(document_id, chunk_index)
          )
        `)
        await client.query('CREATE INDEX IF NOT EXISTS rag_documents_collection_id_idx ON rag_documents(collection_id)')
        await client.query('CREATE INDEX IF NOT EXISTS rag_chunks_document_id_idx ON rag_chunks(document_id)')
        await client.query('CREATE INDEX IF NOT EXISTS rag_chunks_content_tsv_idx ON rag_chunks USING GIN (to_tsvector(\'simple\', content))')
        await client.query('COMMIT')

        initialized = true
        lastError = ''
        return getStatus()
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        lastError = error instanceof Error ? error.message : String(error || '')
        throw error
      } finally {
        client.release()
        initializePromise = null
      }
    })()

    return initializePromise
  }

  async function getStatus() {
    if (!enabled || !databaseUrl) {
      return createDisabledStatus()
    }

    try {
      const result = await ensurePool().query(`
        SELECT
          (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vector_version,
          to_regclass('public.rag_collections') IS NOT NULL AS has_collections_table,
          to_regclass('public.rag_documents') IS NOT NULL AS has_documents_table,
          to_regclass('public.rag_chunks') IS NOT NULL AS has_chunks_table
      `)
      const row = result.rows[0] || {}
      let collectionCount = 0
      let documentCount = 0
      let chunkCount = 0
      let embeddedChunkCount = 0

      if (row.has_collections_table) {
        const countResult = await ensurePool().query('SELECT count(*)::int AS count FROM rag_collections')
        collectionCount = Number(countResult.rows[0]?.count || 0)
      }

      if (row.has_documents_table) {
        const countResult = await ensurePool().query('SELECT count(*)::int AS count FROM rag_documents')
        documentCount = Number(countResult.rows[0]?.count || 0)
      }

      if (row.has_chunks_table) {
        const countResult = await ensurePool().query('SELECT count(*)::int AS count FROM rag_chunks')
        chunkCount = Number(countResult.rows[0]?.count || 0)
        const embeddedCountResult = await ensurePool().query('SELECT count(*)::int AS count FROM rag_chunks WHERE embedding IS NOT NULL')
        embeddedChunkCount = Number(embeddedCountResult.rows[0]?.count || 0)
      }

      return {
        enabled: true,
        ready: Boolean(row.vector_version && row.has_collections_table && row.has_documents_table && row.has_chunks_table),
        vectorVersion: row.vector_version || '',
        embeddingDimension,
        maxSearchResults,
        chunkMaxChars,
        chunkOverlapChars,
        collectionCount,
        documentCount,
        chunkCount,
        embeddedChunkCount,
        embedding: getEmbeddingStatus(),
        error: lastError
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error || '')

      return {
        enabled: true,
        ready: false,
        embeddingDimension,
        maxSearchResults,
        chunkMaxChars,
        chunkOverlapChars,
        embedding: getEmbeddingStatus(),
        error: lastError
      }
    }
  }

  async function upsertDocument({
    documentId = '',
    collectionId = DEFAULT_COLLECTION_ID,
    title = '',
    sourceType = 'manual',
    sourcePath = '',
    metadata = {}
  } = {}) {
    await initialize()

    const normalizedDocumentId = normalizeTrimmedString(documentId) || createId('rag_doc')
    const normalizedCollectionId = normalizeTrimmedString(collectionId) || DEFAULT_COLLECTION_ID
    const normalizedTitle = normalizeTrimmedString(title) || normalizedDocumentId
    await ensureDefaultCollection(normalizedCollectionId)

    await ensurePool().query(
      `
        INSERT INTO rag_documents (document_id, collection_id, title, source_type, source_path, metadata, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
        ON CONFLICT (document_id) DO UPDATE SET
          collection_id = EXCLUDED.collection_id,
          title = EXCLUDED.title,
          source_type = EXCLUDED.source_type,
          source_path = EXCLUDED.source_path,
          metadata = EXCLUDED.metadata,
          updated_at = now()
      `,
      [
        normalizedDocumentId,
        normalizedCollectionId,
        normalizedTitle,
        normalizeTrimmedString(sourceType) || 'manual',
        normalizeTrimmedString(sourcePath),
        JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {})
      ]
    )

    return {
      documentId: normalizedDocumentId,
      collectionId: normalizedCollectionId,
      title: normalizedTitle
    }
  }

  async function ensureDefaultCollection(collectionId = DEFAULT_COLLECTION_ID) {
    await initialize()

    const normalizedCollectionId = normalizeTrimmedString(collectionId) || DEFAULT_COLLECTION_ID

    await ensurePool().query(
      `
        INSERT INTO rag_collections (collection_id, name, description, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (collection_id) DO NOTHING
      `,
      [
        normalizedCollectionId,
        normalizedCollectionId === DEFAULT_COLLECTION_ID ? '默认知识库' : normalizedCollectionId,
        ''
      ]
    )

    return normalizedCollectionId
  }

  async function createCollection({
    name = '',
    description = '',
    metadata = {}
  } = {}) {
    await initialize()

    const normalizedName = normalizeTrimmedString(name)

    if (!normalizedName) {
      throw new Error('Knowledge base name is required.')
    }

    const collectionId = createId('rag_collection')

    await ensurePool().query(
      `
        INSERT INTO rag_collections (collection_id, name, description, metadata, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, now())
      `,
      [
        collectionId,
        normalizedName,
        normalizeTrimmedString(description),
        JSON.stringify(normalizeMetadata(metadata))
      ]
    )

    return {
      collectionId,
      name: normalizedName,
      description: normalizeTrimmedString(description),
      documentCount: 0,
      chunkCount: 0
    }
  }

  async function listCollections() {
    await initialize()

    const result = await ensurePool().query(`
      SELECT
        c.collection_id,
        c.name,
        c.description,
        c.metadata,
        c.created_at,
        c.updated_at,
        count(DISTINCT d.document_id)::int AS document_count,
        count(ch.chunk_id)::int AS chunk_count
      FROM rag_collections c
      LEFT JOIN rag_documents d ON d.collection_id = c.collection_id
      LEFT JOIN rag_chunks ch ON ch.document_id = d.document_id
      GROUP BY c.collection_id
      ORDER BY
        CASE WHEN c.collection_id = $1 THEN 0 ELSE 1 END,
        c.updated_at DESC
    `, [DEFAULT_COLLECTION_ID])

    return result.rows.map((row) => ({
      collectionId: row.collection_id,
      name: row.name,
      description: row.description,
      metadata: row.metadata || {},
      documentCount: Number(row.document_count || 0),
      chunkCount: Number(row.chunk_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  async function replaceDocumentChunks(documentId, chunks) {
    await initialize()

    const normalizedDocumentId = normalizeTrimmedString(documentId)

    if (!normalizedDocumentId) {
      throw new Error('RAG document id is required.')
    }

    const normalizedChunks = Array.isArray(chunks)
      ? chunks.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    const client = await ensurePool().connect()

    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM rag_chunks WHERE document_id = $1', [normalizedDocumentId])

      for (const [index, content] of normalizedChunks.entries()) {
        const embedding = await embedChunkContent(content)
        await client.query(
          `
            INSERT INTO rag_chunks (chunk_id, document_id, chunk_index, content, embedding, metadata, updated_at)
            VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb, now())
          `,
          [
            createId('rag_chunk'),
            normalizedDocumentId,
            index,
            content,
            embedding,
            JSON.stringify({
              charLength: content.length,
              embedded: Boolean(embedding)
            })
          ]
        )
      }

      await client.query('UPDATE rag_documents SET updated_at = now() WHERE document_id = $1', [normalizedDocumentId])
      await client.query('COMMIT')

      return {
        documentId: normalizedDocumentId,
        chunkCount: normalizedChunks.length
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async function ingestTextDocument({
    documentId = '',
    collectionId = DEFAULT_COLLECTION_ID,
    title = '',
    content = '',
    sourceType = 'manual',
    sourcePath = '',
    metadata = {}
  } = {}) {
    const normalizedContent = String(content || '').trim()

    if (!normalizedContent) {
      throw new Error('RAG document content is required.')
    }

    const document = await upsertDocument({
      documentId,
      collectionId,
      title,
      sourceType,
      sourcePath,
      metadata: {
        ...normalizeMetadata(metadata),
        contentLength: normalizedContent.length
      }
    })
    const chunks = splitTextIntoChunks(normalizedContent, {
      maxChars: chunkMaxChars,
      overlapChars: chunkOverlapChars
    })
    const chunkResult = await replaceDocumentChunks(document.documentId, chunks)

    return {
      ...document,
      chunkCount: chunkResult.chunkCount
    }
  }

  async function listDocuments({ collectionId = '', limit = 50 } = {}) {
    await initialize()
    const normalizedCollectionId = normalizeTrimmedString(collectionId)

    const result = await ensurePool().query(
      `
        SELECT
          d.document_id,
          d.collection_id,
          d.title,
          d.source_type,
          d.source_path,
          d.metadata,
          d.created_at,
          d.updated_at,
          count(c.chunk_id)::int AS chunk_count
        FROM rag_documents d
        LEFT JOIN rag_chunks c ON c.document_id = d.document_id
        WHERE ($2::text = '' OR d.collection_id = $2)
        GROUP BY d.document_id
        ORDER BY d.updated_at DESC
        LIMIT $1
      `,
      [normalizeLimit(limit, 50), normalizedCollectionId]
    )

    return result.rows.map((row) => ({
      documentId: row.document_id,
      collectionId: row.collection_id,
      title: row.title,
      sourceType: row.source_type,
      sourcePath: row.source_path,
      metadata: row.metadata || {},
      chunkCount: Number(row.chunk_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  async function search({ query = '', collectionId = '', limit = maxSearchResults } = {}) {
    await initialize()

    const normalizedQuery = normalizeTrimmedString(query)
    const normalizedCollectionId = normalizeTrimmedString(collectionId)
    const searchTerms = extractRagSearchTerms(normalizedQuery)
    let queryEmbedding = null

    if (!normalizedQuery) {
      return []
    }

    try {
      queryEmbedding = await embedChunkContent(normalizedQuery)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error || '')
    }

    const result = await ensurePool().query(
      `
        WITH search_query AS (
          SELECT plainto_tsquery('simple', $1) AS value
        ),
        search_terms AS (
          SELECT unnest($4::text[]) AS value
        )
        SELECT
          c.chunk_id,
          c.document_id,
          c.chunk_index,
          c.content,
          c.metadata,
          d.collection_id,
          d.title,
          d.source_type,
          d.source_path,
          CASE
            WHEN $5::vector IS NULL OR c.embedding IS NULL THEN 0
            ELSE GREATEST(0, 1 - (c.embedding <=> $5::vector))
          END AS vector_score,
          GREATEST(
            ts_rank_cd(to_tsvector('simple', c.content), search_query.value),
            CASE WHEN c.content ILIKE ('%' || $1 || '%') THEN 0.01 ELSE 0 END,
            COALESCE(term_matches.score, 0)
          ) AS lexical_score
        FROM rag_chunks c
        JOIN rag_documents d ON d.document_id = c.document_id
        CROSS JOIN search_query
        LEFT JOIN LATERAL (
          SELECT
            SUM(
              CASE WHEN c.content ILIKE ('%' || search_terms.value || '%') THEN char_length(search_terms.value) ELSE 0 END
              + CASE WHEN d.title ILIKE ('%' || search_terms.value || '%') THEN char_length(search_terms.value) ELSE 0 END
              + CASE WHEN d.source_path ILIKE ('%' || search_terms.value || '%') THEN char_length(search_terms.value) ELSE 0 END
            )::float / 1000 AS score
          FROM search_terms
          WHERE search_terms.value <> ''
        ) term_matches ON true
        WHERE
          ($3::text = '' OR d.collection_id = $3)
          AND (
            to_tsvector('simple', c.content) @@ search_query.value
            OR c.content ILIKE ('%' || $1 || '%')
            OR d.title ILIKE ('%' || $1 || '%')
            OR COALESCE(term_matches.score, 0) > 0
            OR ($5::vector IS NOT NULL AND c.embedding IS NOT NULL)
          )
        ORDER BY ((CASE
            WHEN $5::vector IS NULL OR c.embedding IS NULL THEN 0
            ELSE GREATEST(0, 1 - (c.embedding <=> $5::vector))
          END) * 2 + GREATEST(
            ts_rank_cd(to_tsvector('simple', c.content), search_query.value),
            CASE WHEN c.content ILIKE ('%' || $1 || '%') THEN 0.01 ELSE 0 END,
            COALESCE(term_matches.score, 0)
          )) DESC, d.updated_at DESC, c.chunk_index ASC
        LIMIT $2
      `,
      [normalizedQuery, normalizeLimit(limit, maxSearchResults), normalizedCollectionId, searchTerms, queryEmbedding]
    )

    return result.rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      collectionId: row.collection_id,
      chunkIndex: Number(row.chunk_index || 0),
      title: row.title,
      sourceType: row.source_type,
      sourcePath: row.source_path,
      content: row.content,
      metadata: row.metadata || {},
      score: Number(row.vector_score || 0) * 2 + Number(row.lexical_score || 0),
      vectorScore: Number(row.vector_score || 0),
      lexicalScore: Number(row.lexical_score || 0)
    }))
  }

  async function rebuildEmbeddings({ collectionId = '', limit = 500 } = {}) {
    await initialize()

    const status = getEmbeddingStatus()

    if (!status.enabled) {
      throw new Error('RAG embedding model is not configured.')
    }

    const normalizedCollectionId = normalizeTrimmedString(collectionId)
    const normalizedLimit = normalizeLimit(limit, 500)
    const result = await ensurePool().query(
      `
        SELECT
          c.chunk_id,
          c.content
        FROM rag_chunks c
        JOIN rag_documents d ON d.document_id = c.document_id
        WHERE
          ($1::text = '' OR d.collection_id = $1)
          AND c.embedding IS NULL
        ORDER BY d.updated_at DESC, c.chunk_index ASC
        LIMIT $2
      `,
      [normalizedCollectionId, normalizedLimit]
    )

    let updatedCount = 0

    for (const row of result.rows) {
      const embedding = await embedChunkContent(row.content)

      if (!embedding) {
        continue
      }

      await ensurePool().query(
        `
          UPDATE rag_chunks
          SET
            embedding = $2::vector,
            metadata = metadata || $3::jsonb,
            updated_at = now()
          WHERE chunk_id = $1
        `,
        [
          row.chunk_id,
          embedding,
          JSON.stringify({
            embedded: true,
            embeddedAt: new Date().toISOString()
          })
        ]
      )
      updatedCount += 1
    }

    return {
      requested: result.rows.length,
      updated: updatedCount,
      remainingLimit: normalizedLimit
    }
  }

  async function deleteDocument(documentId) {
    await initialize()

    const normalizedDocumentId = normalizeTrimmedString(documentId)

    if (!normalizedDocumentId) {
      throw new Error('RAG document id is required.')
    }

    const result = await ensurePool().query(
      'DELETE FROM rag_documents WHERE document_id = $1 RETURNING document_id',
      [normalizedDocumentId]
    )

    return {
      deleted: Boolean(result.rowCount)
    }
  }

  async function close() {
    if (pool) {
      await pool.end()
      pool = null
    }
  }

  return {
    initialize,
    getStatus,
    createCollection,
    listCollections,
    upsertDocument,
    ingestTextDocument,
    listDocuments,
    search,
    rebuildEmbeddings,
    deleteDocument,
    close
  }
}
