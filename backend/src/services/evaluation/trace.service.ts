import { z } from 'zod'
import { evaluationClient } from './langsmith'

const evaluationMetadata = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  cases: z.array(z.object({ caseId: z.string() }))
})

export class EvaluationTraceNotFound extends Error {}

export async function getSampleTraceUrl(experimentId: string, sampleIndex: number) {
  const client = evaluationClient()
  const project = await client.readProject({ projectId: experimentId })
  const saved = evaluationMetadata.safeParse(project.extra?.metadata?.code2flow_evaluation)
  if (!saved.success) throw new EvaluationTraceNotFound('找不到这条 Code2Flow 评测记录。')
  const { cases, createdAt } = saved.data
  const sample = cases[sampleIndex]
  if (!sample) throw new EvaluationTraceNotFound('找不到该评测样本。')

  const roots = []
  for await (const root of client.runs.query({
    project_ids: [experimentId], min_start_time: createdAt, is_root: true,
    selects: ['ID', 'TRACE_ID', 'REFERENCE_EXAMPLE_ID', 'START_TIME', 'OUTPUTS']
  })) {
    if (root.reference_example_id && root.outputs?.caseId === sample.caseId) roots.push(root)
  }
  roots.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
  const occurrence = cases.slice(0, sampleIndex).filter((item) => item.caseId === sample.caseId).length
  const root = roots[occurrence]
  if (!root?.trace_id) throw new EvaluationTraceNotFound('LangSmith 中找不到该样本的 Trace。')

  const { url } = await client.runs.getURL(root.id, {
    project_id: experimentId, trace_id: root.trace_id, start_time: root.start_time
  })
  return z.url({ protocol: /^https?$/ }).parse(url)
}
