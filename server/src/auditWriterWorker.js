import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parentPort } from 'node:worker_threads'

if (!parentPort) {
  throw new Error('Audit writer worker requires a parent port.')
}

parentPort.on('message', async (message = {}) => {
  if (message.type !== 'append') {
    return
  }

  try {
    for (const write of Array.isArray(message.writes) ? message.writes : []) {
      await mkdir(dirname(write.filePath), { recursive: true })
      await appendFile(write.filePath, write.content || '', 'utf8')
    }

    parentPort.postMessage({
      type: 'appended',
      requestId: message.requestId
    })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      requestId: message.requestId,
      code: error?.code,
      message: error instanceof Error ? error.message : String(error || 'Audit writer failed.')
    })
  }
})
