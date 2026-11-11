import { http } from './http'

export interface EvaluationDataset {
  id: string
  name: string
  exampleCount: number | null
}

export interface EvaluationCase {
  caseId: string
  status: 'passed' | 'failed'
  error: string | null
  durationMs: number
  modelCalls: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  stages: { stage: string; durationMs: number }[]
  files: { path: string; chunks: { lineStart: number; lineEnd: number; chars: number }[] }[]
}

export interface EvaluationRun {
  id: string
  datasetId: string
  name: string
  createdAt: string
  model: string
  datasetVersion: string | null
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  totalCases: number
  progress: { stage: string; completed: number; total: number } | null
  cases: EvaluationCase[]
  error: string | null
  experimentId?: string
  experimentUrl: string | null
}

export interface EvaluationTraceNode {
  id: string
  parentId: string | null
  name: string
  kind: string
  status: string
  startedAt: string
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  model: string | null
  taskId: string | null
  attempt: number | null
}

export interface EvaluationTrace {
  traceId: string
  nodes: EvaluationTraceNode[]
}

export interface EvaluationSpanDetail {
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
  parameters: Record<string, unknown>
  error: string | null
}

export async function fetchEvaluationDatasets() {
  return (await http.get<EvaluationDataset[]>('/evaluations/datasets', { timeout: 25000 })).data
}

export async function fetchEvaluationRuns(datasetId: string) {
  return (await http.get<EvaluationRun[]>(`/evaluations/datasets/${datasetId}/runs`, { timeout: 25000 })).data
}

export async function fetchCurrentEvaluation(datasetId: string) {
  return (await http.get<EvaluationRun | null>(`/evaluations/datasets/${datasetId}/current`)).data
}

export async function startEvaluation(datasetId: string, name: string) {
  return (await http.post<EvaluationRun>('/evaluations/runs', { datasetId, name })).data
}

export async function fetchEvaluationTrace(experimentId: string, sampleIndex: number, signal: AbortSignal) {
  return (await http.get<EvaluationTrace>(`/evaluations/experiments/${experimentId}/samples/${sampleIndex}/trace`, {
    timeout: 30000, signal
  })).data
}

export async function fetchEvaluationSpan(experimentId: string, traceId: string, spanId: string, signal: AbortSignal) {
  return (await http.get<EvaluationSpanDetail>(`/evaluations/experiments/${experimentId}/traces/${traceId}/spans/${spanId}`, {
    timeout: 30000, signal
  })).data
}
