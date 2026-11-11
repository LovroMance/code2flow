import { z } from 'zod'
import { evaluationClient } from './langsmith'

const evaluationMetadata = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  cases: z.array(z.object({ caseId: z.string() }))
})

export class EvaluationTraceNotFound extends Error {}

async function readTraceProject(experimentId: string) {
  const client = evaluationClient()
  const project = await client.readProject({ projectId: experimentId })
  const saved = evaluationMetadata.safeParse(project.extra?.metadata?.code2flow_evaluation)
  if (!saved.success) throw new EvaluationTraceNotFound('找不到这条 Code2Flow 评测记录。')
  return { client, saved: saved.data }
}

export async function getSampleTrace(experimentId: string, sampleIndex: number) {
  const { client, saved } = await readTraceProject(experimentId)
  const sample = saved.cases[sampleIndex]
  if (!sample) throw new EvaluationTraceNotFound('找不到该评测样本。')

  const query = { project_ids: [experimentId], min_start_time: saved.createdAt }
  const roots = []
  for await (const root of client.runs.query({
    ...query, is_root: true, selects: ['ID', 'TRACE_ID', 'REFERENCE_EXAMPLE_ID', 'START_TIME', 'OUTPUTS']
  })) {
    if (root.reference_example_id && root.outputs?.caseId === sample.caseId) roots.push(root)
  }
  roots.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
  const occurrence = saved.cases.slice(0, sampleIndex).filter((item) => item.caseId === sample.caseId).length
  const root = roots[occurrence]
  if (!root?.trace_id) throw new EvaluationTraceNotFound('LangSmith 中找不到该样本的 Trace。')

  const nodes = []
  for await (const row of client.runs.query({
    ...query, filter: `eq(trace_id, "${root.trace_id}")`,
    selects: [
      'ID', 'NAME', 'RUN_TYPE', 'STATUS', 'START_TIME', 'LATENCY_SECONDS', 'PARENT_RUN_IDS',
      'PROMPT_TOKENS', 'COMPLETION_TOKENS', 'TOTAL_TOKENS', 'METADATA'
    ]
  })) {
    const parents = row.parent_run_ids
    const meta = row.metadata
    nodes.push({
      id: row.id,
      parentId: parents?.[parents.length - 1] ?? null,
      name: row.name ?? '未命名步骤',
      kind: row.run_type ?? 'chain',
      status: row.status ?? '',
      startedAt: row.start_time ?? '',
      durationMs: row.latency_seconds != null ? Math.round(row.latency_seconds * 1000) : null,
      inputTokens: row.prompt_tokens ?? null,
      outputTokens: row.completion_tokens ?? null,
      totalTokens: row.total_tokens ?? null,
      model: typeof meta?.ls_model_name === 'string' ? meta.ls_model_name : null,
      taskId: typeof meta?.task_id === 'string' ? meta.task_id : null,
      attempt: typeof meta?.attempt === 'number' ? meta.attempt : null
    })
  }
  return { traceId: root.trace_id, nodes: nodes.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) }
}

const visibleParams = new Set([
  'model', 'temperature', 'tools', 'tool_choice', 'reasoning_effort', 'response_format',
  'max_tokens', 'max_completion_tokens', 'stream', 'stream_options'
])

export async function getTraceSpan(experimentId: string, traceId: string, spanId: string) {
  const { client } = await readTraceProject(experimentId)
  const span = await client.runs.retrieve(spanId, {
    project_id: experimentId, selects: ['TRACE_ID', 'INPUTS', 'OUTPUTS', 'ERROR', 'EXTRA']
  })
  if (span.trace_id !== traceId) throw new EvaluationTraceNotFound('找不到这条 Trace 下的步骤。')
  return {
    input: span.inputs ?? null,
    output: span.outputs ?? null,
    error: span.error ?? null,
    parameters: Object.fromEntries(Object.entries(span.extra?.invocation_params ?? {})
      .filter(([name]) => visibleParams.has(name)))
  }
}
