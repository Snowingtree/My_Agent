import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import {
  cloneValue,
  createId,
  createEmptyTask,
  createMessage,
  createSessionRecord,
  createSessionTitle,
  isRunningTaskStatus,
  nowIso,
  sortSessionsByUpdatedAt
} from './utils.js'

function createSessionSummary(session) {
  return {
    sessionId: session.sessionId,
    title: session.title,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessageAt: session.lastMessageAt,
    lastAiId: session.lastAiId,
    lastModel: session.lastModel,
    lastSkillId: session.lastSkillId || '',
    lastSkillIds: Array.isArray(session.lastSkillIds) ? session.lastSkillIds : [],
    workspaceFolder: String(session.workspaceFolder || '').trim(),
    workspaceFiles: Array.isArray(session.workspaceFiles) ? session.workspaceFiles : [],
    task: session.task
      ? {
        taskId: session.task.taskId,
        title: session.task.title,
        status: session.task.status,
        summary: session.task.summary,
        updatedAt: session.task.updatedAt,
        steps: Array.isArray(session.task.steps) ? session.task.steps : []
      }
      : null
  }
}

async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const rawValue = await readFile(filePath, 'utf8')

    if (!rawValue.trim()) {
      return fallbackValue
    }

    return JSON.parse(rawValue)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallbackValue
    }

    throw error
  }
}

function normalizeRepositoryOptions(options) {
  if (typeof options === 'string') {
    return {
      sessionsDir: resolve(dirname(options), 'sessions'),
      legacyFilePath: options,
      onSessionUpdated: null,
      onSessionDeleted: null,
      onMessageAppended: null
    }
  }

  return {
    sessionsDir: String(options?.sessionsDir || '').trim(),
    legacyFilePath: String(options?.legacyFilePath || '').trim(),
    onSessionUpdated: typeof options?.onSessionUpdated === 'function' ? options.onSessionUpdated : null,
    onSessionDeleted: typeof options?.onSessionDeleted === 'function' ? options.onSessionDeleted : null,
    onMessageAppended: typeof options?.onMessageAppended === 'function' ? options.onMessageAppended : null
  }
}

export class SessionRepository {
  constructor(options) {
    const normalizedOptions = normalizeRepositoryOptions(options)
    this.sessionsDir = normalizedOptions.sessionsDir
    this.legacyFilePath = normalizedOptions.legacyFilePath
    this.onSessionUpdated = normalizedOptions.onSessionUpdated
    this.onSessionDeleted = normalizedOptions.onSessionDeleted
    this.onMessageAppended = normalizedOptions.onMessageAppended
    this.pendingWrite = Promise.resolve()
    this.didAttemptLegacyMigration = false
  }

  async ensure() {
    await ensureDirectory(this.sessionsDir)
  }

  getSessionFilePath(sessionId) {
    return join(this.sessionsDir, `${sessionId}.json`)
  }

  async listSessionFilePaths() {
    await this.ensure()
    const entries = await readdir(this.sessionsDir, { withFileTypes: true })

    return entries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
      .map((entry) => join(this.sessionsDir, entry.name))
  }

  async readLegacySessions() {
    if (!this.legacyFilePath) {
      return []
    }

    const parsedValue = await readJsonFile(this.legacyFilePath, [])
    return Array.isArray(parsedValue) ? parsedValue : []
  }

  async readSessionFile(filePath) {
    const parsedValue = await readJsonFile(filePath, null)
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null
  }

  async writeSessionFile(session) {
    const sessionId = String(session?.sessionId || '').trim()

    if (!sessionId) {
      throw new Error('Cannot persist a session without a sessionId.')
    }

    const filePath = this.getSessionFilePath(sessionId)
    await ensureDirectory(dirname(filePath))
    await writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  }

  async migrateLegacySessionsIfNeeded() {
    if (this.didAttemptLegacyMigration) {
      return
    }

    await this.ensure()
    const existingSessionFiles = await this.listSessionFilePaths()

    if (existingSessionFiles.length) {
      this.didAttemptLegacyMigration = true
      return
    }

    const legacySessions = await this.readLegacySessions()

    if (!legacySessions.length) {
      this.didAttemptLegacyMigration = true
      return
    }

    for (const session of legacySessions) {
      await this.writeSessionFile(session)
    }

    this.didAttemptLegacyMigration = true
  }

  async readAll() {
    await this.migrateLegacySessionsIfNeeded()

    const filePaths = await this.listSessionFilePaths()
    const sessions = []

    for (const filePath of filePaths) {
      const session = await this.readSessionFile(filePath)

      if (session) {
        sessions.push(session)
      }
    }

    return sessions
  }

  async writeAll(sessions) {
    await this.ensure()

    const existingFiles = await this.listSessionFilePaths()
    const nextFilePaths = new Set()

    for (const session of sessions) {
      await this.writeSessionFile(session)
      nextFilePaths.add(this.getSessionFilePath(session.sessionId))
    }

    for (const filePath of existingFiles) {
      if (!nextFilePaths.has(filePath)) {
        await unlink(filePath)
      }
    }
  }

  async transact(mutator) {
    let result

    this.pendingWrite = this.pendingWrite.then(async () => {
      const currentSessions = await this.readAll()
      const draftSessions = cloneValue(currentSessions)
      result = await mutator(draftSessions)
      await this.writeAll(draftSessions)
    })

    await this.pendingWrite
    return result
  }

  async listSummaries() {
    const sessions = await this.readAll()
    return sortSessionsByUpdatedAt(sessions.map((item) => createSessionSummary(item)))
  }

  async getSession(sessionId) {
    const targetPath = this.getSessionFilePath(sessionId)
    const directSession = await this.readSessionFile(targetPath)

    if (directSession) {
      return cloneValue(directSession)
    }

    const sessions = await this.readAll()
    return cloneValue(sessions.find((item) => item.sessionId === sessionId) || null)
  }

  async createSession() {
    let createdSession = null

    await this.transact((sessions) => {
      createdSession = createSessionRecord()
      sessions.push(createdSession)
    })

    if (createdSession && this.onSessionUpdated) {
      await this.onSessionUpdated(cloneValue(createdSession))
    }

    return cloneValue(createdSession)
  }

  async upsertWorkspaceFile(sessionId, fileInfo = {}) {
    const normalizedPath = String(fileInfo.path || '').trim()

    if (!normalizedPath) {
      return null
    }

    return this.updateSession(sessionId, (session) => {
      const nextFile = {
        path: normalizedPath,
        artifactPath: String(fileInfo.artifactPath || '').trim(),
        sizeBytes: Number.isFinite(fileInfo.sizeBytes) ? fileInfo.sizeBytes : null,
        updatedAt: String(fileInfo.updatedAt || nowIso()).trim() || nowIso()
      }

      const workspaceFiles = Array.isArray(session.workspaceFiles) ? [...session.workspaceFiles] : []
      const existingIndex = workspaceFiles.findIndex((item) => item.path === nextFile.path)

      if (existingIndex === -1) {
        workspaceFiles.unshift(nextFile)
      } else {
        workspaceFiles.splice(existingIndex, 1)
        workspaceFiles.unshift(nextFile)
      }

      session.workspaceFiles = workspaceFiles
      session.updatedAt = nowIso()

      return session
    })
  }

  async deleteSession(sessionId) {
    let removed = false

    await this.transact((sessions) => {
      const targetIndex = sessions.findIndex((item) => item.sessionId === sessionId)

      if (targetIndex === -1) {
        return
      }

      sessions.splice(targetIndex, 1)
      removed = true
    })

    if (removed && this.onSessionDeleted) {
      await this.onSessionDeleted(sessionId)
    }

    return removed
  }

  async updateSession(sessionId, updater) {
    let updatedSession = null

    await this.transact((sessions) => {
      const targetIndex = sessions.findIndex((item) => item.sessionId === sessionId)

      if (targetIndex === -1) {
        return
      }

      const currentSession = cloneValue(sessions[targetIndex])
      const nextSession = updater(currentSession)

      if (!nextSession) {
        return
      }

      sessions[targetIndex] = nextSession
      updatedSession = cloneValue(nextSession)
    })

    if (updatedSession && this.onSessionUpdated) {
      await this.onSessionUpdated(cloneValue(updatedSession))
    }

    return updatedSession
  }

  async prepareSessionForTask({ sessionId, message, aiId, model, skillId = '', skillIds = [] }) {
    const normalizedMessage = String(message ?? '')
    const timestamp = nowIso()
    const nextTaskId = createId('task')
    const normalizedSkillIds = Array.isArray(skillIds)
      ? [...new Set(
        skillIds
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )]
      : []

    return this.updateSession(sessionId, (session) => {
      const nextTitle = session.title === '新对话'
        ? createSessionTitle(normalizedMessage)
        : session.title

      session.title = nextTitle
      session.updatedAt = timestamp
      session.lastMessageAt = timestamp
      session.lastAiId = aiId
      session.lastModel = model
      session.lastSkillId = String(skillId || '').trim()
      session.lastSkillIds = normalizedSkillIds
      session.messages = Array.isArray(session.messages) ? session.messages : []
      session.messages.push(createMessage({
        role: 'user',
        content: normalizedMessage
      }))
      session.task = {
        ...createEmptyTask(nextTitle),
        taskId: nextTaskId,
        title: nextTitle,
        status: 'queued',
        summary: '助手已接收目标，正在准备执行。',
        steps: [],
        startedAt: timestamp,
        completedAt: null,
        updatedAt: timestamp
      }

      return session
    })
  }

  async appendAssistantMessage(sessionId, { content, model = '', usage } = {}) {
    return this.appendMessage(sessionId, {
      role: 'assistant',
      content,
      model,
      usage
    })
  }

  async appendToolMessage(sessionId, { content } = {}) {
    return this.appendMessage(sessionId, {
      role: 'tool',
      content
    })
  }

  async appendMessage(sessionId, {
    role = 'assistant',
    content,
    model = '',
    usage
  } = {}) {
    const timestamp = nowIso()
    const message = createMessage({
      role,
      content,
      model,
      usage
    })

    const updatedSession = await this.updateSession(sessionId, (session) => {
      session.updatedAt = timestamp
      session.lastMessageAt = timestamp
      session.messages = Array.isArray(session.messages) ? session.messages : []
      session.messages.push(message)

      return session
    })

    if (updatedSession && this.onMessageAppended) {
      try {
        await this.onMessageAppended({
          sessionId,
          session: cloneValue(updatedSession),
          message: cloneValue(message)
        })
      } catch (error) {
        console.warn('[agent-api] failed to persist token usage:', error instanceof Error ? error.message : error)
      }
    }

    return updatedSession
  }

  async recoverInterruptedTasks() {
    await this.transact((sessions) => {
      const timestamp = nowIso()

      for (const session of sessions) {
        if (!isRunningTaskStatus(session?.task?.status)) {
          continue
        }

        const nextSteps = Array.isArray(session.task.steps)
          ? session.task.steps.map((step) => (
            isRunningTaskStatus(step?.status)
              ? {
                ...step,
                status: 'failed',
                summary: step.summary || '助手服务已重启，之前的执行已中断。',
                completedAt: timestamp,
                updatedAt: timestamp
              }
              : step
          ))
          : []

        session.updatedAt = timestamp
        session.task = {
          ...session.task,
          status: 'failed',
          summary: '助手服务已重启，之前的任务未能执行完成。',
          steps: nextSteps,
          completedAt: timestamp,
          updatedAt: timestamp
        }
      }
    })
  }
}
