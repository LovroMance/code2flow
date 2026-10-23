import { buildLanguageDetectionQuestion } from '../../prompts/detect-language.prompt'

// 配置和鉴权错误需要修正环境，不能作为普通的语言不确定继续执行。
export class LanguageDetectionConfigError extends Error {}

export async function requestLanguageChoice(
  code: string,
  model: string,
  timeout: number,
  signal?: AbortSignal,
  onUsage?: (info: { model: string; usage: Record<string, number> }) => void
) {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey || apiKey === 'your_typesafe_api_key_here') {
    console.error('[code-flow][jev] config-error: TYPESAFE_API_KEY 未配置')
    throw new LanguageDetectionConfigError('请在后端配置 TYPESAFE_API_KEY')
  }

  // 在请求时加载 SDK，确保 dotenv 已生效。
  const { TypeSafeClient } = await import('@typesafe-ai/sdk').catch(() => {
    console.error('[code-flow][jev] config-error: SDK 加载失败')
    throw new LanguageDetectionConfigError('请先安装后端依赖 @typesafe-ai/sdk')
  })
  const client = new TypeSafeClient({ apiKey, defaultModel: model, logLevel: 'off' })
  const startedAt = Date.now()
  console.info('[code-flow][jev] request-start', { model, timeoutMs: timeout })
  try {
    const response = await client.systemOne(
      {
        model,
        state: { code },
        questions: { language: buildLanguageDetectionQuestion() }
      },
      {
        timeout,
        retry: { maxRetries: 0 },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout)
      }
    )
    console.info('[code-flow][jev] request-complete', {
      model: response.model,
      durationMs: Date.now() - startedAt,
      usage: response.usage
    })
    const allowed = new Set([
      'input_tokens',
      'output_tokens',
      'total_tokens',
      'prompt_tokens',
      'completion_tokens',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'promptTokens',
      'completionTokens'
    ])
    onUsage?.({
      model: response.model,
      usage: Object.fromEntries(
        Object.entries(response.usage ?? {}).filter(
          ([key, value]) =>
            allowed.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0
        )
      ) as Record<string, number>
    })
    return response.answers.language
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    console.error('[code-flow][jev] request-failed', {
      message: '语言识别服务请求失败',
      model,
      durationMs: Date.now() - startedAt,
      httpStatus: status,
      errorType: error instanceof Error ? error.name : 'UnknownError'
    })
    if (status === 401 || status === 403 || status === 404) {
      throw new LanguageDetectionConfigError(
        `Jev 配置错误（HTTP ${status}），请检查密钥、权限和模型配置`
      )
    }
    throw error
  }
}
