import { describe, expect, it } from 'vitest'
import { createTraceCollector, summarizeResult } from '../src/ai/observability/trace.builder'
import { resolveRunConfig, hashCode } from '../src/ai/observability/run-config'
import type { FlowGenerationResult } from '../src/domain/flow/types'

describe('observability / run-config', () => {
  it('produces a stable config hash for identical configs', () => {
    const a = resolveRunConfig({ maxRetries: 1 })
    const b = resolveRunConfig({ maxRetries: 1 })

    expect(a.configHash).toBe(b.configHash)
    expect(a.configHash).toHaveLength(12)
  })

  it('changes the config hash when maxRetries changes', () => {
    const a = resolveRunConfig({ maxRetries: 1 })
    const b = resolveRunConfig({ maxRetries: 3 })

    expect(a.configHash).not.toBe(b.configHash)
  })

  it('hashes code while ignoring line ending differences', () => {
    expect(hashCode('const a = 1\nconst b = 2')).toBe(hashCode('const a = 1\r\nconst b = 2'))
  })
})

describe('observability / trace builder', () => {
  it('accumulates steps, llm rounds, usage and retries', async () => {
    const trace = createTraceCollector({ code: 'const a = 1', mode: 'generate', maxRetries: 1 })

    trace.addStep({ name: 'detect-language', ok: true, durationMs: 5 })
    trace.addStep({ name: 'validate#0', ok: false, durationMs: 3, error: 'invalid mermaid' })
    trace.countLlmRound()
    trace.countLlmRound()
    trace.addUsage({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })
    trace.addUsage({ promptTokens: 20, completionTokens: 10, totalTokens: 30 })
    trace.setRetryCount(1)
    trace.setValidationErrors(['invalid mermaid'])

    const finished = await trace.finish()

    expect(finished.steps).toHaveLength(2)
    expect(finished.steps[1].ok).toBe(false)
    expect(finished.steps[1].error).toBe('invalid mermaid')
    expect(finished.usage.llmRounds).toBe(2)
    expect(finished.usage.totalTokens).toBe(180)
    expect(finished.usage.retryCount).toBe(1)
    expect(finished.usage.validationErrors).toEqual(['invalid mermaid'])
    expect(finished.outcome).toBe('success')
    expect(finished.input.codeHash).toHaveLength(16)
    expect(finished.input.codeLines).toBe(1)
  })

  it('marks the trace as errored when an error is set', async () => {
    const trace = createTraceCollector({ code: 'x', mode: 'generate' })
    trace.setError('model timeout')

    const finished = await trace.finish()

    expect(finished.outcome).toBe('error')
    expect(finished.error).toBe('model timeout')
  })

  it('keeps outcome success only when no error was reported', async () => {
    const trace = createTraceCollector({ code: 'x', mode: 'generate' })
    trace.addStep({ name: 'detect-language', ok: true, durationMs: 1 })

    const finished = await trace.finish()

    expect(finished.outcome).toBe('success')
    expect(finished.error).toBeUndefined()
  })

  it('summarizes a result into counts without storing the raw mermaid', () => {
    const result: FlowGenerationResult = {
      detectedLanguage: 'javascript',
      mermaid: 'flowchart TD\n  A --> B\n  B --> C',
      mappings: [
        {
          nodeId: 'A',
          kind: 'start',
          label: 'start',
          description: 'entry',
          lineStart: 1,
          lineEnd: 1
        },
        {
          nodeId: 'B',
          kind: 'decision',
          label: 'check',
          description: 'branch',
          lineStart: 2,
          lineEnd: 3
        },
        {
          nodeId: 'C',
          kind: 'return',
          label: 'done',
          description: 'exit',
          lineStart: 4,
          lineEnd: 4
        }
      ]
    }

    const summary = summarizeResult(result)

    expect(summary.detectedLanguage).toBe('javascript')
    expect(summary.mermaidLines).toBe(3)
    expect(summary.mappingCount).toBe(3)
    expect(summary.nodeKinds).toEqual({ start: 1, decision: 1, return: 1 })
    // 行 2 和 3 都被 B 覆盖，去重后总计 4 行。
    expect(summary.coveredLineCount).toBe(4)
  })
})
