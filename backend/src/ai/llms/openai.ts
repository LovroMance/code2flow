import { ChatOpenAI } from '@langchain/openai'

export function createOpenAIModel(purpose?: 'index') {
  const model = process.env.DEEPSEEK_MODEL?.trim()
  const baseURL = process.env.DEEPSEEK_BASE_URL?.trim()
  if (!model || !baseURL) throw new Error('请配置 DEEPSEEK_MODEL 和 DEEPSEEK_BASE_URL。')
  const useLowReasoning =
    purpose === 'index' &&
    model === 'deepseek-v4.1-flash' &&
    URL.parse(baseURL)?.hostname === 'cn-beijing.maas.qianwenaiapi.com'

  return new ChatOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    model,
    configuration: { baseURL },
    // 不发送 max_tokens，由模型服务决定单次输出长度。
    // 通过兼容接口的原始字段传递百炼推理强度。
    ...(useLowReasoning && { modelKwargs: { reasoning_effort: 'low' } }),
    streaming: true,
    streamUsage: true,
    // OpenAI 兼容协议不代表实际供应商是 OpenAI，供远程面板匹配自定义价格。
    metadata: {
      ls_provider: 'deepseek',
      ls_model_name: model
    },
    // 重试由外层 StateGraph 统一计数，避免 SDK 与业务层叠加放大请求次数。
    maxRetries: 0,
    timeout: 60000,
    // 通过环境变量调整生成结果的稳定性。
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE ?? 0)
  })
}
