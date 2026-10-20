import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemorySaver } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCodeFlowGraph, createCodeFlowGraph } from '../src/ai/graph/code-flow.graph'
import { createTraceCollector } from '../src/ai/observability/trace.builder'
import { code, result, createModelServer } from './fixtures/model.fixture'

const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})
async function setup(replies: Parameters<typeof createModelServer>[0]) {
  const server = await createModelServer(replies)
  cleanup.push(server.close)
  return { ...server, options: { model: server.model, checkpointer: new MemorySaver() } }
}

describe('native LangChain agent + LangGraph', () => {
  it('executes native graph nodes and validates the structured tool response', async () => {
    const { options, requests } = await setup([{}])
    const state = await runCodeFlowGraph({ code, threadId: 'generate' }, options)
    expect(state.result).toEqual({ ...result, mermaid: result.mermaid.trim() })
    expect(state.attempts).toBe(1)
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0].tools)).toContain('submit_code_flow_result')
    expect(createCodeFlowGraph(options).getGraph().nodes).toHaveProperty('analyze')
  })

  it('streams partial Mermaid before completion and preserves metadata and usage', async () => {
    const { options } = await setup([{}])
    const trace = createTraceCollector({ code, mode: 'generate' })
    const partials: string[] = []
    const metadata = vi.fn()
    let finished = false
    await runCodeFlowGraph(
      { code },
      {
        ...options,
        trace,
        callbacks: {
          onPartialMermaid: (source) => {
            expect(finished).toBe(false)
            partials.push(source)
          },
          onDetectedLanguage: metadata
        }
      }
    )
    finished = true
    expect(partials.length).toBeGreaterThan(0)
    expect(partials.every((source) => source.startsWith('flowchart TD'))).toBe(true)
    expect(metadata).toHaveBeenCalledWith({
      detectedLanguage: 'javascript',
      confidence: expect.any(Number)
    })
    const recorded = await trace.finish()
    expect(recorded.usage.llmRounds).toBe(1)
    expect(recorded.usage.totalTokens).toBe(30)
    expect(recorded.steps.map((step) => step.name)).toEqual(['analyze', 'validate'])
  })

  it('retries schema errors with concrete feedback in the next model request', async () => {
    const { options, requests } = await setup([{ args: { mermaid: 'bad' } }, {}])
    const state = await runCodeFlowGraph({ code, maxRetries: 1 }, options)
    expect(state.attempts).toBe(2)
    expect(state.error).toBeNull()
    expect(JSON.stringify(requests[1].messages)).toContain('上次生成未通过校验')
  })

  it('retries transport failures rather than bypassing the graph', async () => {
    const { options } = await setup([{ status: 503 }, {}])
    expect((await runCodeFlowGraph({ code, maxRetries: 1 }, options)).attempts).toBe(2)
  })

  it('enforces Zod cross-field line constraints after framework JSON schema validation', async () => {
    const { options } = await setup([
      { args: { ...result, mappings: [{ ...result.mappings[0], lineStart: 2, lineEnd: 1 }] } }
    ])
    await expect(runCodeFlowGraph({ code, maxRetries: 0 }, options)).rejects.toThrow('lineEnd')
  })

  it('passes failed Mermaid validation back to the next attempt', async () => {
    const { options, requests } = await setup([
      { args: { ...result, mermaid: 'graph LR\nn_start_1 --> n_action_1 --> n_end_1' } },
      {}
    ])
    expect((await runCodeFlowGraph({ code, maxRetries: 1 }, options)).attempts).toBe(2)
    expect(JSON.stringify(requests[1].messages)).toContain('Generated Mermaid is invalid')
  })

  it('honors the environment retry limit and stops at the configured bound', async () => {
    vi.stubEnv('CODE2FLOW_MAX_RETRIES', '0')
    const { options, requests } = await setup([
      { args: { ...result, detectedLanguage: 'vue' } },
      {}
    ])
    await expect(runCodeFlowGraph({ code }, options)).rejects.toThrow('Detected language mismatch')
    expect(requests).toHaveLength(1)
  })

  it('rejects invalid retry configuration before invoking the model', async () => {
    const { options, requests } = await setup([{}])
    await expect(runCodeFlowGraph({ code, maxRetries: -1 }, options)).rejects.toThrow(
      'CODE2FLOW_MAX_RETRIES'
    )
    expect(requests).toHaveLength(0)
  })

  it('validates duplicate IDs and normalizes comment line mappings', async () => {
    const bad = { ...result, mappings: [result.mappings[0], result.mappings[0]] }
    const { options } = await setup([{ args: bad }, {}])
    const state = await runCodeFlowGraph({ code: '// comment\n\n' + code, maxRetries: 1 }, options)
    expect(state.attempts).toBe(2)
    expect(state.result?.mappings.every((mapping) => mapping.lineStart === 3)).toBe(true)
  })

  it('remembers prior questions, isolates threads and rejects changed source', async () => {
    const { options, requests } = await setup([
      {},
      { text: '第一次解释' },
      { text: '继续解释' },
      {}
    ])
    await runCodeFlowGraph({ code, threadId: 'chat' }, options)
    await runCodeFlowGraph(
      { code, threadId: 'chat', mode: 'followup', question: '解释赋值' },
      options
    )
    const state = await runCodeFlowGraph(
      { code: '', threadId: 'chat', mode: 'followup', question: '继续解释它' },
      options
    )
    expect(state.messages).toHaveLength(4)
    expect(JSON.stringify(requests[2].messages)).toContain('第一次解释')
    await expect(
      runCodeFlowGraph(
        { code: code + '\nchanged()', threadId: 'chat', mode: 'followup', question: '为什么' },
        options
      )
    ).rejects.toThrow('代码已变更')
    await expect(
      runCodeFlowGraph(
        { code: '', threadId: 'other', mode: 'followup', question: '为什么' },
        options
      )
    ).rejects.toThrow('Missing previous flow result')
    const regenerated = await runCodeFlowGraph({ code, threadId: 'chat' }, options)
    expect(regenerated.messages).toHaveLength(0)
  })

  it('does not reuse a previous result after regeneration fails', async () => {
    const { options } = await setup([{}, { status: 500 }])
    const dir = await mkdtemp(join(tmpdir(), 'code2flow-stale-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const file = join(dir, 'legacy.json')
    await writeFile(file, JSON.stringify({ 'generate:stale': { code, result } }))
    vi.stubEnv('CODE2FLOW_CHECKPOINT_FILE', file)
    await runCodeFlowGraph({ code, threadId: 'stale' }, options)
    await expect(
      runCodeFlowGraph({ code, threadId: 'stale', maxRetries: 0 }, options)
    ).rejects.toThrow()
    await expect(
      runCodeFlowGraph({ code, threadId: 'stale', mode: 'followup', question: '解释' }, options)
    ).rejects.toThrow('Missing previous flow result')
  })

  it('restores native SQLite state after closing and reopening the database', async () => {
    const { model, requests } = await setup([
      {},
      { text: '重启前的解释' },
      { text: '重启后的解释' }
    ])
    const dir = await mkdtemp(join(tmpdir(), 'code2flow-sqlite-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const file = join(dir, 'graph.sqlite')
    const first = SqliteSaver.fromConnString(file)
    await runCodeFlowGraph({ code, threadId: 'persisted' }, { model, checkpointer: first })
    await runCodeFlowGraph(
      { code, threadId: 'persisted', mode: 'followup', question: '第一次提问' },
      { model, checkpointer: first }
    )
    first.db.close()
    const second = SqliteSaver.fromConnString(file)
    cleanup.push(() => second.db.close())
    const state = await runCodeFlowGraph(
      { code: '', threadId: 'persisted', mode: 'followup', question: '解释' },
      { model, checkpointer: second }
    )
    expect(state.explanation).toBe('重启后的解释')
    expect(state.code).toBe(code)
    expect(state.messages).toHaveLength(4)
    expect(JSON.stringify(requests[2].messages)).toContain('重启前的解释')
  })

  it('imports an old JSON thread on demand without modifying the source file', async () => {
    const { options } = await setup([{ text: '旧图解释' }])
    const dir = await mkdtemp(join(tmpdir(), 'code2flow-legacy-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const file = join(dir, 'old.json')
    const raw = JSON.stringify({ 'generate:legacy': { code, result } })
    await writeFile(file, raw)
    vi.stubEnv('CODE2FLOW_CHECKPOINT_FILE', file)
    const state = await runCodeFlowGraph(
      { code: '', threadId: 'legacy', mode: 'followup', question: '解释' },
      options
    )
    expect(state.explanation).toBe('旧图解释')
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(file, 'utf8')).toBe(raw)
  })
})
