import { buildLanguageDetectionQuestion } from '../../prompts/detect-language.prompt'
import { traceStep } from '../observability/langsmith'

// 配置和鉴权错误需要修正环境，不能作为普通的语言不确定继续执行。
export class LanguageDetectionConfigError extends Error {}

export async function requestLanguageChoice(
  code: string,
  model: string,
  timeout: number,
  signal?: AbortSignal
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
  try {
    // SDK 实例、密钥和取消信号不作为追踪输入，原始响应保留供应商 usage。
    const response = await traceStep(
      'code2flow.jev-choice',
      {
        model,
        state: { code },
        questions: { language: buildLanguageDetectionQuestion() }
      },
      (request) =>
        client.systemOne(request, {
          timeout,
          retry: { maxRetries: 0 },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
            : AbortSignal.timeout(timeout)
        })
    )
    return response.answers.language
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    console.error('[code-flow][jev] request-failed', {
      message: '语言识别服务请求失败',
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
