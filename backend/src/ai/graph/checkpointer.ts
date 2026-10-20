import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { z } from 'zod'
import { GenerationResultSchema } from '../../domain/flow/schema'

let checkpointer: SqliteSaver | undefined

// 延迟打开官方 SQLite saver，确保 dotenv 已加载；检查点事务和序列化交给框架。
export function getCodeFlowCheckpointer() {
  if (!checkpointer) {
    const file = resolve(
      process.env.CODE2FLOW_CHECKPOINT_DB ?? '.code2flow/checkpoints/code-flow.sqlite'
    )
    mkdirSync(dirname(file), { recursive: true })
    checkpointer = SqliteSaver.fromConnString(file)
  }
  return checkpointer
}

// 兼容旧线程：仅在 SQLite 无该线程时导入旧快照，不覆盖或修改原 JSON 文件。
export async function loadLegacyCheckpoint(threadId: string) {
  const file =
    process.env.CODE2FLOW_CHECKPOINT_FILE ?? '.code2flow/checkpoints/code-flow-checkpoints.json'
  try {
    const store = JSON.parse(await readFile(file, 'utf8'))
    return z
      .object({
        code: z.string(),
        result: GenerationResultSchema,
        explanation: z.string().optional()
      })
      .optional()
      .parse(store[`generate:${threadId}`])
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
