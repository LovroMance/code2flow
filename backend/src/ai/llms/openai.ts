import { ChatOpenAI } from '@langchain/openai'

export function createOpenAIModel() {
  return new ChatOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
    },
    modelKwargs: {
      response_format: {
        type: 'json_object'
      }
    },
    maxTokens: 4000,
    temperature: 0
  })
}
