import { createRequire } from 'node:module'

type Metadata = Record<string, unknown>

type Dataset = { id: string; name: string; example_count?: number }
type Example = { id: string; inputs: unknown }
type Project = { id: string; name: string; extra?: { metadata?: Metadata } }

type TraceRun = {
  id: string
  trace_id?: string
  name?: string
  run_type?: string
  status?: string
  start_time?: string
  latency_seconds?: number
  parent_run_ids?: string[]
  reference_example_id?: string
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  metadata?: Metadata
  extra?: { invocation_params?: Metadata }
  error?: string
  inputs?: Metadata
  outputs?: Metadata
}

interface LangSmithClient {
  listDatasets(options: { limit: number }): AsyncIterable<Dataset>
  readDataset(options: { datasetId: string }): Promise<Dataset>
  listExamples(options: { datasetId: string }): AsyncIterable<Example>
  listProjects(options: { referenceDatasetId: string; limit: number }): AsyncIterable<Project>
  readProject(options: { projectName: string } | { projectId: string }): Promise<Project>
  updateProject(id: string, options: { metadata: Metadata; endTime: string }): Promise<unknown>
  getProjectUrl(options: { projectId: string }): Promise<string>
  runs: {
    query(options: {
      project_ids: string[]
      min_start_time: string
      is_root?: boolean
      filter?: string
      selects: string[]
    }): AsyncIterable<TraceRun>
    retrieve(id: string, options: { project_id: string; selects: string[] }): Promise<TraceRun>
  }
}

// 从现有 LangChain 依赖解析 SDK，让 evaluate 和 Agent 追踪共享同一套上下文。
const requireFromCore = createRequire(require.resolve('@langchain/core/tracers/tracer_langchain'))
const { Client } = requireFromCore('langsmith') as {
  Client: new (options: { apiUrl: string; apiKey: string; workspaceId?: string }) => LangSmithClient
}
export const { evaluate } = requireFromCore('langsmith/evaluation') as {
  evaluate: (
    target: (inputs: unknown) => Promise<Metadata>,
    options: {
      data: Example[]
      client: LangSmithClient
      experimentPrefix: string
      maxConcurrency: number
      metadata: Metadata
    }
  ) => Promise<{ experimentName: string }>
}

export function evaluationClient() {
  const apiKey = process.env.LANGSMITH_API_KEY?.trim()
  const apiUrl = process.env.LANGSMITH_ENDPOINT?.trim()
  if (!apiKey || !apiUrl)
    throw new Error('请在后端配置 LANGSMITH_API_KEY 和 LANGSMITH_ENDPOINT。')
  return new Client({ apiKey, apiUrl, workspaceId: process.env.LANGSMITH_WORKSPACE_ID?.trim() || undefined })
}
