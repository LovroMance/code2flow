import type { CodeFlowGraphCheckpointer } from '../code-flow.types'
import type { CodeFlowGraphCheckpoint, CodeFlowGraphMode } from '../code-flow.state'
import { buildCheckpointKey } from './checkpoint-key'

const checkpointStore = new Map<string, CodeFlowGraphCheckpoint>()

// 先提供一个进程内 checkpointer，方便本地联调 follow-up 链路。
export const inMemoryCodeFlowCheckpointer: CodeFlowGraphCheckpointer = {
  async load(input: { threadId: string; mode: CodeFlowGraphMode }) {
    return checkpointStore.get(buildCheckpointKey(input.threadId, input.mode)) ?? null
  },

  async save(input: {
    threadId: string
    mode: CodeFlowGraphMode
    checkpoint: CodeFlowGraphCheckpoint
  }) {
    checkpointStore.set(buildCheckpointKey(input.threadId, input.mode), input.checkpoint)
  }
}
