import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { createWorkspace } from './workspace.js'

function isWithinPath(rootDir, targetPath) {
  const relativePath = relative(rootDir, targetPath)

  return (
    relativePath === ''
    || relativePath === '.'
    || (
      !relativePath.startsWith('..')
      && !relativePath.includes('/../')
      && !relativePath.includes('\\..\\')
      && relativePath !== '..'
    )
  )
}

export function createSessionWorkspacesRepository({
  baseDir,
  sourceWorkspace,
  writeMode = 'session'
} = {}) {
  const sourceRootDir = resolve(String(sourceWorkspace?.rootDir || '.'))
  const requestedRootDir = resolve(String(baseDir || '.'))
  const directSourceWrites = String(writeMode || '').trim().toLowerCase() !== 'session'
  const rootDir = isWithinPath(sourceRootDir, requestedRootDir)
    ? resolve(dirname(sourceRootDir), `${basename(sourceRootDir)}-session-workspaces`)
    : requestedRootDir

  function resolveSessionDir(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId) {
      throw new Error('Session id is required for the session workspace.')
    }

    return resolve(rootDir, normalizedSessionId)
  }

  function getWorkspaceFolderLabel(sessionId) {
    if (directSourceWrites) {
      return basename(sourceRootDir)
    }

    const normalizedSessionId = String(sessionId || '').trim()

    if (!normalizedSessionId) {
      return basename(rootDir)
    }

    return `${basename(rootDir)}/${normalizedSessionId}`.replace(/\\/g, '/')
  }

  async function ensureSessionWorkspace(sessionId) {
    if (directSourceWrites) {
      await mkdir(rootDir, { recursive: true })

      return {
        rootDir: sourceRootDir,
        created: true
      }
    }

    const sessionDir = resolveSessionDir(sessionId)
    await mkdir(sessionDir, { recursive: true })

    return {
      rootDir: sessionDir,
      created: true
    }
  }

  async function deleteSessionWorkspace(sessionId) {
    if (directSourceWrites) {
      return
    }

    const targetDir = resolveSessionDir(sessionId)
    await rm(targetDir, { recursive: true, force: true })
  }

  function resolveWorkspace(sessionId) {
    if (directSourceWrites) {
      return createWorkspace({
        rootDir: sourceRootDir
      })
    }

    const sessionDir = resolveSessionDir(sessionId)

    return createWorkspace({
      rootDir: sessionDir
    })
  }

  function createWorkspaceFileRecord(sessionId, relativePath, {
    sizeBytes = null,
    updatedAt = ''
  } = {}) {
    const normalizedPath = String(relativePath || '').trim().replace(/\\/g, '/')

    return {
      path: normalizedPath,
      artifactPath: `${getWorkspaceFolderLabel(sessionId)}/${normalizedPath}`.replace(/\\/g, '/'),
      sizeBytes,
      updatedAt: String(updatedAt || '').trim()
    }
  }

  async function readWorkspaceFile(sessionId, relativePath, maxFileSizeBytes = 256 * 1024) {
    const workspace = resolveWorkspace(sessionId)
    const target = workspace.resolvePath(relativePath)
    const fileHandle = await open(target.absolutePath, 'r')

    try {
      const fileStat = await fileHandle.stat()

      if (!fileStat.isFile()) {
        throw new Error('The requested path is not a file.')
      }

      const bytesToRead = Math.min(fileStat.size, maxFileSizeBytes)
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, 0)
      const contentBuffer = buffer.subarray(0, bytesRead)

      if (contentBuffer.includes(0)) {
        throw new Error('The requested file appears to be binary and cannot be previewed as text.')
      }

      return {
        path: target.relativePath,
        content: contentBuffer.toString('utf8'),
        truncated: fileStat.size > maxFileSizeBytes,
        sizeBytes: fileStat.size,
        updatedAt: new Date(fileStat.mtimeMs).toISOString()
      }
    } finally {
      await fileHandle.close()
    }
  }

  async function listWorkspaceFiles(sessionId, trackedFiles = []) {
    const workspace = resolveWorkspace(sessionId)

    if (directSourceWrites) {
      const normalizedTrackedFiles = Array.isArray(trackedFiles) ? trackedFiles : []
      const files = []

      for (const item of normalizedTrackedFiles) {
        const relativePath = String(item?.path || '').trim()

        if (!relativePath) {
          continue
        }

        try {
          const target = workspace.resolvePath(relativePath)
          const fileStat = await stat(target.absolutePath)

          if (!fileStat.isFile()) {
            continue
          }

          files.push(createWorkspaceFileRecord(sessionId, target.relativePath, {
            sizeBytes: fileStat.size,
            updatedAt: new Date(fileStat.mtimeMs).toISOString()
          }))
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            throw error
          }
        }
      }

      return files.sort((left, right) => (
        String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || ''))
      ))
    }

    const files = []

    async function walk(relativePath = '.') {
      const target = workspace.resolvePath(relativePath)
      const entries = await readdir(target.absolutePath, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))

      for (const entry of entries) {
        const childRelativePath = relativePath === '.'
          ? entry.name
          : `${relativePath}/${entry.name}`

        if (entry.isDirectory()) {
          await walk(childRelativePath)
          continue
        }

        if (!entry.isFile()) {
          continue
        }

        const childTarget = workspace.resolvePath(childRelativePath)
        const fileStat = await stat(childTarget.absolutePath)

        files.push(createWorkspaceFileRecord(sessionId, childTarget.relativePath, {
          sizeBytes: fileStat.size,
          updatedAt: new Date(fileStat.mtimeMs).toISOString()
        }))
      }
    }

    try {
      await walk('.')
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }

    return files.sort((left, right) => (
      String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || ''))
    ))
  }

  return {
    rootDir,
    sourceRootDir,
    directSourceWrites,
    ensureSessionWorkspace,
    deleteSessionWorkspace,
    getWorkspaceFolderLabel,
    listWorkspaceFiles,
    readWorkspaceFile,
    resolveWorkspace,
    createWorkspaceFileRecord
  }
}
