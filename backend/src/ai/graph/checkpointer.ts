import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'

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
