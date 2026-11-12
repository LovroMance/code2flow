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
  diagnosticCount: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
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

export interface EvaluationAgentStage {
  id: string
  label: string
  model: string | null
  systemPrompt: string | null
  temperature?: number | null
  reasoningEffort?: string | null
  runLimit?: number
  tools: { name: string; description: string; schema: object }[]
  choice?: {
    instructions: string
    criteria: Record<string, string>
    timeoutMs: number | null
    minConfidence: number | null
  }
}

export async function fetchEvaluationAgentConfig(signal: AbortSignal) {
  return (await http.get<{ stages: EvaluationAgentStage[] }>('/evaluations/agent-config', { signal })).data
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

export function evaluationTraceLink(experimentId: string, sampleIndex: number) {
  return `/api/evaluations/experiments/${encodeURIComponent(experimentId)}/samples/${sampleIndex}/trace`
}
