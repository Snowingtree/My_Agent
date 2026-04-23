import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

async function collectOutputFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectOutputFiles(absolutePath)))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const fileStat = await stat(absolutePath)
    files.push(fileStat.size)
  }

  return files
}

function printBuildSizePlugin() {
  let resolvedConfig

  return {
    name: 'print-build-size-summary',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config
    },
    async closeBundle() {
      if (!resolvedConfig) {
        return
      }

      const outputDirectory = resolve(resolvedConfig.root, resolvedConfig.build.outDir)
      const files = await collectOutputFiles(outputDirectory)

      if (!files.length) {
        console.log('\n[build-size] No output files were found.')
        return
      }

      const totalSize = files.reduce((sum, size) => sum + size, 0)
      console.log(`\n[build-size] Total: ${formatBytes(totalSize)} | Files: ${files.length}`)
    }
  }
}

export default defineConfig(({ mode }) => {
  const projectRoot = process.cwd()
  const env = loadEnv(mode, projectRoot, '')
  const apiProxyTarget = env.API_PROXY_TARGET || 'http://127.0.0.1:3001'

  return {
    base: '/agent/',
    plugins: [vue(), printBuildSizePlugin()],
    resolve: {
      alias: {
        '@': resolve(projectRoot, 'src')
      }
    },
    server: {
      host: '127.0.0.1',
      port: 5175,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    }
  }
})
