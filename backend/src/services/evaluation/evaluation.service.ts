import { createHash, randomUUID } from 'node:crypto'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { z } from 'zod'
import { traceStep } from '../../ai/observability/langsmith'
import { SourceFilesSchema } from '../../domain/source/schema'
import { chineseErrorMessage } from '../../utils/errorMessage'
import { MultiFileService } from '../multifile.service'
import { SessionService } from '../session.service'
import { evaluate, evaluationClient } from './langsmith'
import { EvaluationMetrics } from './metrics'

const sampleSchema = z.object({ case_id: z.string().optional(), files: SourceFilesSchema })
const progressSchema = z.object({ stage: z.string(), completed: z.number(), total: z.number() })
const recordedStage = new Set(['prepare', 'detect', 'basic', 'index', 'resolve', 'generate'])
const metric = z.number().nonnegative().nullable()
const resultCount = z.number().int().nonnegative().nullable().default(null)
const caseSchema = z.object({
  caseId: z.string(),
  status: z.enum(['passed', 'failed']),
  error: z.string().nullable(),
  durationMs: z.number().nonnegative(),
  modelCalls: z.number().nonnegative(),
  diagnosticCount: resultCount,
  nodeCount: resultCount,
  inputTokens: metric,
  outputTokens: metric,
  totalTokens: metric
})
const runSchema = z.object({
  id: z.uuid(),
  datasetId: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  model: z.string(),
  datasetVersion: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  totalCases: z.number(),
  progress: progressSchema.nullable(),
  cases: z.array(caseSchema),
  error: z.string().nullable(),
  experimentId: z.uuid().optional(),
  experimentUrl: z.url({ protocol: /^https?$/ }).nullable()
})
type EvaluationRun = z.infer<typeof runSchema>
type CaseResult = z.infer<typeof caseSchema>

let latestRun: EvaluationRun | undefined

export async function getDatasets() {
  const datasets = []
  for await (const dataset of evaluationClient().listDatasets({ limit: 100 })) {
    datasets.push({ id: dataset.id, name: dataset.name, exampleCount: dataset.example_count ?? null })
  }
  return datasets
}

export async function getRuns(datasetId: string) {
  const runs = new Map<string, EvaluationRun>()
  for await (const project of evaluationClient().listProjects({ referenceDatasetId: datasetId, limit: 40 })) {
    const saved = runSchema.safeParse(project.extra?.metadata?.code2flow_evaluation)
    if (!saved.success) continue
    const run = saved.data
    run.experimentId = project.id
    if (run.status === 'running') {
      run.status = 'interrupted'
      run.progress = null
    }
    runs.set(run.id, run)
  }
  if (latestRun?.datasetId === datasetId) runs.set(latestRun.id, latestRun)
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getCurrentRun(datasetId: string) {
  return latestRun?.datasetId === datasetId ? latestRun : null
}

export function startRun(datasetId: string, name: string) {
  if (latestRun?.status === 'running') return null
  const run: EvaluationRun = {
    id: randomUUID(), datasetId, name, createdAt: new Date().toISOString(),
    model: process.env.DEEPSEEK_MODEL?.trim() || '', datasetVersion: null,
    status: 'running', totalCases: 0, progress: null, cases: [], error: null, experimentUrl: null
  }
  latestRun = run
  void execute(run)
  return run
}

async function execute(run: EvaluationRun) {
  try {
    const client = evaluationClient()
    const dataset = await client.readDataset({ datasetId: run.datasetId })
    const examples = []
    for await (const example of client.listExamples({ datasetId: dataset.id })) examples.push(example)
    run.totalCases = examples.length
    if (examples.length === 0) throw new Error('数据集没有样本，请先在 LangSmith 添加文件样本。')
    run.name ||= dataset.name
    run.datasetVersion = createHash('sha256').update(JSON.stringify(
      examples.map(({ id, inputs }) => ({ id, inputs })).sort((a, b) => a.id.localeCompare(b.id))
    )).digest('hex')

    const experiment = await evaluate(async function evaluateCode2FlowSample(inputs) {
      const result = await runCase(inputs, run)
      run.cases.push(result)
      return result
    }, {
      data: examples,
      client,
      experimentPrefix: run.name,
      maxConcurrency: 1,
      metadata: { code2flow_evaluation: { ...run, cases: [] } }
    })
    const status = run.cases.every((sample) => sample.status === 'passed') ? 'completed' : 'failed'
    run.progress = null
    try {
      const project = await client.readProject({ projectName: experiment.experimentName })
      run.experimentId = project.id
      run.experimentUrl = await client.getProjectUrl({ projectId: project.id }).catch(() => null)
      await client.updateProject(project.id, {
        endTime: new Date().toISOString(),
        metadata: { ...project.extra?.metadata, code2flow_evaluation: { ...run, status } }
      })
    } catch {
      run.error = '实验已运行，LangSmith 历史摘要保存失败。可在数据集的实验列表查看各样本。'
    }
    run.status = status
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    run.error = message.startsWith('请在后端配置') || message.startsWith('数据集没有样本')
      ? message
      : chineseErrorMessage(error, '实验运行失败，请检查 LangSmith 配置、权限和网络连接。', false)
    run.status = 'failed'
    run.progress = null
  }
}

async function runCase(inputs: unknown, run: EvaluationRun): Promise<CaseResult> {
  const started = performance.now()
  const metrics = new EvaluationMetrics()
  const sample = sampleSchema.safeParse(inputs)
  const caseId = (sample.success && sample.data.case_id) || `样本 ${run.cases.length + 1}`
  let failure: string | null = null
  let diagnosticCount: number | null = null
  let nodeCount: number | null = null
  run.progress = null

  if (sample.success) {
    const saver = SqliteSaver.fromConnString(':memory:')
    try {
      const sessionId = randomUUID()
      const service = new MultiFileService(saver)
      new SessionService(saver).ensure(sessionId, { title: caseId })
      const snapshot = await service.createSnapshot(sessionId, sample.data.files)
      const result = await traceStep('code2flow.evaluate-sample', { caseId }, () =>
        service.generate(sessionId, snapshot.snapshotId, new AbortController().signal, (_event, payload) => {
          const parsed = progressSchema.safeParse(payload)
          if (parsed.success && recordedStage.has(parsed.data.stage)) run.progress = parsed.data
        }), { callbacks: [metrics] }
      )
      diagnosticCount = result.diagnostics.length
      nodeCount = result.mappings.length
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    } finally {
      saver.db.close()
    }
  } else {
    failure = '样本的 inputs.files 需要包含文件名（path）和源码（content）。'
  }

  return {
    caseId, status: failure ? 'failed' : 'passed', error: failure, diagnosticCount, nodeCount,
    durationMs: Math.round(performance.now() - started), ...metrics.snapshot()
  }
}
