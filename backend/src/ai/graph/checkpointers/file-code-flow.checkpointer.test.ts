import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createFileCodeFlowCheckpointer } from './file-code-flow.checkpointer'

describe('file code flow checkpointer', () => {
  it('persists checkpoints to disk and reloads them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'code2flow-checkpoint-'))
    const filePath = join(dir, 'checkpoints.json')
    const checkpointer = createFileCodeFlowCheckpointer(filePath)

    await checkpointer.save({
      threadId: 'thread-1',
      mode: 'generate',
      checkpoint: {
        code: 'const answer = 42',
        detectedLanguage: 'javascript'
      }
    })

    const restored = await createFileCodeFlowCheckpointer(filePath).load({
      threadId: 'thread-1',
      mode: 'generate'
    })
    const fileContent = await readFile(filePath, 'utf8')

    expect(restored?.code).toBe('const answer = 42')
    expect(restored?.detectedLanguage).toBe('javascript')
    expect(fileContent).toContain('thread-1')
  })

  it('shares generate checkpoints with followup reads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'code2flow-checkpoint-'))
    const filePath = join(dir, 'checkpoints.json')
    const checkpointer = createFileCodeFlowCheckpointer(filePath)

    await checkpointer.save({
      threadId: 'thread-2',
      mode: 'generate',
      checkpoint: {
        code: 'const saved = true',
        explanation: 'stored explanation'
      }
    })

    const restored = await checkpointer.load({
      threadId: 'thread-2',
      mode: 'followup'
    })

    expect(restored?.code).toBe('const saved = true')
    expect(restored?.explanation).toBe('stored explanation')
  })
})
