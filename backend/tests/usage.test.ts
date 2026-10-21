import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app/createApp'
import { createTraceCollector } from '../src/ai/observability/trace.builder'
import { readUsageRecords } from '../src/ai/observability/usage.reader'
import { resetTraceSinkForTesting } from '../src/ai/observability/trace.sink'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'code2flow-usage-'))
  file = join(dir, 'runs.jsonl')
  vi.stubEnv('CODE2FLOW_TRACE_FILE', file)
  resetTraceSinkForTesting()
})
afterEach(async () => {
  vi.unstubAllEnvs()
  resetTraceSinkForTesting()
  await rm(dir, { recursive: true, force: true })
})

async function makeTrace() {
  const trace = createTraceCollector({ code: '私有源码', mode: 'generate', source: 'online' })
  trace.countLlmRound()
  trace.setResponseModel?.('deepseek-flash')
  trace.addUsage({ promptTokens: 20, completionTokens: 10, totalTokens: 30 })
  return trace.finish()
}

describe('生成用量列表', () => {
  it('累计重试、保留失败时已知用量并区分缺失回报', async () => {
    const collector = createTraceCollector({ code: 'x', mode: 'generate' })
    collector.countLlmRound()
    collector.addUsage({ promptTokens: 20, completionTokens: 10, totalTokens: 30 })
    collector.countLlmRound()
    collector.addUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
    collector.setRetryCount(1)
    collector.setError('校验失败')
    const full = await collector.finish()
    expect(full.usage.totalTokens).toBe(45)
    expect(full.usage.reportedRounds).toBe(2)
    collector.countLlmRound()
    collector.addUsage({ promptTokens: -1 })
    const partial = await collector.finish()
    await writeFile(
      file,
      `${JSON.stringify(full)}\n${JSON.stringify({ ...partial, runId: 'partial' })}\n`
    )
    const { records } = await readUsageRecords(file)
    expect(records[0]).toMatchObject({
      completeness: 'complete',
      outcome: 'error',
      totalTokens: 45,
      retryCount: 1
    })
    expect(records.find((record) => record.runId === 'partial')).toMatchObject({
      completeness: 'partial',
      totalTokens: 45
    })
  })

  it('兼容旧记录，跳过损坏行、追问、评估和未写完的末行', async () => {
    const trace = await makeTrace()
    const legacy = {
      ...trace,
      source: undefined,
      usage: { ...trace.usage, reportedRounds: undefined }
    }
    const missing = {
      ...trace,
      runId: 'missing',
      usage: {
        ...trace.usage,
        reportedRounds: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }
    }
    const lines = [
      legacy,
      missing,
      { ...trace, source: 'eval' },
      { ...trace, input: { mode: 'followup' } },
      { bad: true }
    ]
    await writeFile(
      file,
      lines.map((value) => JSON.stringify(value)).join('\n') + '\nbad json\n{"unfinished":'
    )
    const { records } = await readUsageRecords(file)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      completeness: 'unknown',
      source: 'unknown',
      totalTokens: 30
    })
    expect(records[1]).toMatchObject({ completeness: 'missing', totalTokens: null })
  })

  it('真实零用量仍展示为零，并按开始时间倒序限制 50 条', async () => {
    const trace = await makeTrace()
    const lines = Array.from({ length: 60 }, (_, index) => ({
      ...trace,
      runId: String(index),
      startedAt: new Date(1700000000000 + index * 1000).toISOString(),
      usage: { ...trace.usage, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    }))
    await writeFile(file, lines.map((value) => JSON.stringify(value)).join('\n') + '\n')
    const { records } = await readUsageRecords(file)
    expect(records).toHaveLength(50)
    expect(records[0]).toMatchObject({ runId: '59', totalTokens: 0, completeness: 'complete' })
    expect(records[49].runId).toBe('10')
  })

  it('限制大文件扫描范围，仍能读取末尾完整记录', async () => {
    const trace = await makeTrace()
    await writeFile(file, 'x'.repeat(4 * 1024 * 1024 + 1) + '\n' + JSON.stringify(trace) + '\n')
    const result = await readUsageRecords(file)
    expect(result.scanLimited).toBe(true)
    expect(result.records).toHaveLength(1)
  })

  it('接口只返回白名单字段，关闭记录时仍可查看历史', async () => {
    const trace = await makeTrace()
    await writeFile(
      file,
      JSON.stringify({ ...trace, code: '不能返回源码', error: '不能返回内部错误' }) + '\n'
    )
    vi.stubEnv('CODE2FLOW_TRACE', 'off')
    const response = await request(createApp()).get('/api/usage').expect(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.tracingEnabled).toBe(false)
    expect(response.body.records[0]).toMatchObject({
      requestedModel: trace.config.model,
      responseModels: ['deepseek-flash']
    })
    expect(response.text).not.toContain('不能返回')
    expect(response.body.records[0]).not.toHaveProperty('input')
    expect(response.body.records[0]).not.toHaveProperty('config')
  })

  it('首次无文件返回空列表，文件不可读时返回通用错误', async () => {
    const app = createApp()
    const empty = await request(app).get('/api/usage').expect(200)
    expect(empty.body.records).toEqual([])
    vi.stubEnv('CODE2FLOW_TRACE_FILE', dir)
    const failed = await request(app).get('/api/usage').expect(500)
    expect(failed.body).toEqual({ error: '读取用量记录失败，请稍后重试' })
  })
})
