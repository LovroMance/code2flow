import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CodeFlowGraphCheckpointer } from '../code-flow.types'
import type { CodeFlowGraphCheckpoint, CodeFlowGraphMode } from '../code-flow.state'
import { buildCheckpointKey } from './checkpoint-key'

type CheckpointStoreRecord = Record<string, CodeFlowGraphCheckpoint>

// 文件版 checkpointer 让当前项目在单机开发和单实例部署下具备最基本的跨重启会话能力。
export function createFileCodeFlowCheckpointer(filePath: string): CodeFlowGraphCheckpointer {
  const resolvedFilePath = resolve(filePath)
  let cache: CheckpointStoreRecord | null = null
  let pendingWrite = Promise.resolve()

  return {
    async load(input: { threadId: string; mode: CodeFlowGraphMode }) {
      const store = await ensureStoreLoaded()
      return store[buildCheckpointKey(input.threadId, input.mode)] ?? null
    },

    async save(input: {
      threadId: string
      mode: CodeFlowGraphMode
      checkpoint: CodeFlowGraphCheckpoint
    }) {
      const store = await ensureStoreLoaded()
      store[buildCheckpointKey(input.threadId, input.mode)] = input.checkpoint

      // 串行化写入，避免连续请求并发覆盖 checkpoint 文件。
      pendingWrite = pendingWrite.then(async () => {
        await mkdir(dirname(resolvedFilePath), { recursive: true })
        await writeFile(resolvedFilePath, JSON.stringify(store, null, 2), 'utf8')
      })

      await pendingWrite
    }
  }

  async function ensureStoreLoaded() {
    if (cache) {
      return cache
    }

    try {
      const raw = await readFile(resolvedFilePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      cache = isCheckpointStoreRecord(parsed) ? parsed : {}
    } catch (error) {
      if (isMissingFileError(error)) {
        cache = {}
      } else {
        throw error
      }
    }

    return cache
  }
}

function isCheckpointStoreRecord(value: unknown): value is CheckpointStoreRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isMissingFileError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
