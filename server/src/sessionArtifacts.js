import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function normalizeSessionId(value) {
  return String(value || '').trim()
}

function normalizeRelativePath(value) {
  return String(value || '').trim().replace(/\\/g, '/')
}

function sortFilesByUpdatedAt(items) {
  return [...items].sort((left, right) => (
    String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || ''))
  ))
}

export function createSessionArtifactsRepository({
  baseDir,
  workspace
} = {}) {
  const rootDir = resolve(String(baseDir || '.'))

  function resolveSessionDir(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId)

    if (!normalizedSessionId) {
      throw new Error('Session id is required for session artifacts.')
    }

    return resolve(rootDir, normalizedSessionId)
  }

  async function ensureSessionDir(sessionId) {
    await mkdir(resolveSessionDir(sessionId), { recursive: true })
  }

  async function deleteSessionDir(sessionId) {
    const targetDir = resolveSessionDir(sessionId)
    await rm(targetDir, { recursive: true, force: true })
  }

  async function captureWorkspaceFile(sessionId, relativePath) {
    const normalizedRelativePath = normalizeRelativePath(relativePath)

    if (!normalizedRelativePath || normalizedRelativePath === '.') {
      throw new Error('A relative workspace file path is required for artifact capture.')
    }

    const sourceTarget = workspace.resolvePath(normalizedRelativePath)
    const sessionDir = resolveSessionDir(sessionId)
    const artifactTargetPath = resolve(sessionDir, normalizedRelativePath)
    const fileContent = await readFile(sourceTarget.absolutePath)

    await mkdir(dirname(artifactTargetPath), { recursive: true })
    await writeFile(artifactTargetPath, fileContent)

    const fileStat = await stat(artifactTargetPath)

    return {
      path: sourceTarget.relativePath,
      artifactPath: `${normalizeSessionId(sessionId)}/${sourceTarget.relativePath}`.replace(/\\/g, '/'),
      sizeBytes: fileStat.size,
      updatedAt: new Date(fileStat.mtimeMs).toISOString()
    }
  }

  function listSessionFiles(files) {
    return sortFilesByUpdatedAt(Array.isArray(files) ? files : [])
  }

  return {
    rootDir,
    ensureSessionDir,
    deleteSessionDir,
    captureWorkspaceFile,
    listSessionFiles
  }
}
