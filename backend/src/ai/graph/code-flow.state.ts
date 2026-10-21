import { MessagesValue, StateSchema } from '@langchain/langgraph'
import { z } from 'zod'
import { GenerationResultSchema, LanguageDetectionSchema } from '../../domain/flow/schema'
import { SupportedLanguageSchema } from '../../domain/flow/language'

// 原生状态通道由 LangGraph 合并和持久化；消息通道保留当前图的追问历史。
export const CodeFlowState = new StateSchema({
  code: z.string().default(''),
  mode: z.enum(['generate', 'followup']).default('generate'),
  question: z.string().default(''),
  detectedLanguage: SupportedLanguageSchema.default('unknown'),
  languageDetection: LanguageDetectionSchema.nullable().default(null),
  result: GenerationResultSchema.nullable().default(null),
  explanation: z.string().default(''),
  error: z.string().nullable().default(null),
  attempts: z.number().default(0),
  maxRetries: z.number().default(1),
  messages: MessagesValue
})

export type CodeFlowGraphState = typeof CodeFlowState.State
