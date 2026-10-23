import { ChatOpenAI } from '@langchain/openai'
import { modelOutputTokens } from '../../services/multifile-config'

export function createOpenAIModel(maxTokens = modelOutputTokens()) {
  return new ChatOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
    },
    maxTokens,
    streaming: true,
    // 重试由外层 StateGraph 统一计数，避免 SDK 与业务层叠加放大请求次数。
    maxRetries: 0,
    timeout: 60000,
    // temperature 可配：A/B 实验时它是主要自变量之一，写死就没法做对照。
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE ?? 0)
  })
}
