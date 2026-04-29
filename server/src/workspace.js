import { relative, resolve, sep } from 'node:path'

function normalizeRelativePath(value) {
  const normalized = String(value || '.').trim().replace(/\\/g, '/')
  return normalized || '.'
}

function ensureInsideRoot(rootDir, absolutePath) {
  const relativePath = relative(rootDir, absolutePath)

  if (
    !relativePath
    || relativePath === '.'
    || (
      !relativePath.startsWith('..')
      && !relativePath.includes(`${sep}..${sep}`)
      && relativePath !== '..'
    )
  ) {
    return
  }

  throw new Error('Path is outside of the workspace root.')
}

export function createWorkspace(workspaceConfig = {}) {
  const rootDir = resolve(String(workspaceConfig.rootDir || '.'))

  function resolvePath(inputPath = '.') {
    const relativePath = normalizeRelativePath(inputPath)
    const absolutePath = resolve(rootDir, relativePath)

    ensureInsideRoot(rootDir, absolutePath)

    return {
      rootDir,
      inputPath: relativePath,
      absolutePath,
      relativePath: relative(rootDir, absolutePath).replace(/\\/g, '/') || '.'
    }
  }

  function toRelativePath(absolutePath) {
    const resolvedPath = resolve(String(absolutePath || rootDir))

    ensureInsideRoot(rootDir, resolvedPath)

    return relative(rootDir, resolvedPath).replace(/\\/g, '/') || '.'
  }

  return {
    rootDir,
    resolvePath,
    toRelativePath
  }
}
