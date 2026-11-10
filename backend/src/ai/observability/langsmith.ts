import {
  ensureConfig,
  mergeConfigs,
  RunnableLambda,
  type RunnableConfig
} from '@langchain/core/runnables'

/** 在 dotenv 加载后初始化；配置缺失时关闭上传，不影响正常分析。 */
export function configureLangSmith() {
  if (process.env.LANGSMITH_TRACING !== 'true') return
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    process.env.LANGSMITH_TRACING = 'false'
    console.warn('[code2flow][langsmith] 未填写 LANGSMITH_API_KEY，已关闭远程追踪。')
    return
  }
  const endpoint = process.env.LANGSMITH_ENDPOINT?.trim()
  try {
    if (!endpoint) throw new Error('缺少地址')
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('无效地址')
  } catch {
    process.env.LANGSMITH_TRACING = 'false'
    console.warn('[code2flow][langsmith] LANGSMITH_ENDPOINT 无效，已关闭远程追踪。')
    return
  }
  const project = process.env.LANGSMITH_PROJECT?.trim()
  if (!project) {
    process.env.LANGSMITH_TRACING = 'false'
    console.warn('[code2flow][langsmith] 未填写 LANGSMITH_PROJECT，已关闭远程追踪。')
    return
  }
  process.env.LANGSMITH_ENDPOINT = endpoint
  process.env.LANGSMITH_PROJECT = project
  // SDK 对空字符串和未设置的处理不同；可选 workspace 留空时使用账号默认值。
  if (!process.env.LANGSMITH_WORKSPACE_ID?.trim()) delete process.env.LANGSMITH_WORKSPACE_ID
  console.info('[code2flow][langsmith] 远程追踪已启用，输入输出将上传至配置的项目。')
}

/** 仅记录显式输入输出，依赖和密钥留在闭包中；原生 Runnable 继承并行任务的回调上下文。 */
export function traceStep<Input, Output>(
  name: string,
  input: Input,
  operation: (input: Input) => Promise<Output>,
  config?: RunnableConfig
): Promise<Output> {
  return RunnableLambda.from(operation).invoke(
    input,
    inheritTraceConfig({ ...config, runName: name })
  )
}

/** 显式回调数组会覆盖隐式配置，因此合并父上下文，保留 SSE、预算和远程追踪的共同父节点。 */
export function inheritTraceConfig(config: RunnableConfig): RunnableConfig {
  return mergeConfigs(ensureConfig(), config)
}

export function analysisTraceConfig(
  operation: 'generate' | 'followup' | 'multifile' | 'multifile-followup',
  sessionId?: string,
  details: Record<string, unknown> = {}
): RunnableConfig {
  return {
    tags: ['code2flow', operation],
    metadata: {
      operation,
      // v2 saver 使用内部随机线程；展示会话统一使用用户会话 ID，不修改 configurable。
      ...(sessionId ? { session_id: sessionId, thread_id: sessionId } : {}),
      ...details
    }
  }
}
