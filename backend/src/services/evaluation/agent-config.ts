import { toJsonSchema } from '@langchain/core/utils/json_schema'
import { FOLLOW_UP_RUN_LIMIT, structuredAgentConfig } from '../../ai/chains/multifile.chain'
import { getAnalysisModelSettings } from '../../ai/llms/openai'
import { getLanguageDetectionSettings } from '../../ai/tools/detect-language.tool'
import { buildLanguageDetectionQuestion } from '../../prompts/detect-language.prompt'
import { FOLLOW_UP_PROMPT } from '../../prompts/follow-up.prompt'
import { SOURCE_TOOLS } from '../source-context.service'

function modelDetails(purpose?: 'index') {
  const { model, temperature, reasoningEffort } = getAnalysisModelSettings(purpose)
  return { model: model || null, temperature, reasoningEffort }
}

export function getAgentConfiguration() {
  const question = buildLanguageDetectionQuestion()
  const detection = getLanguageDetectionSettings().data
  const labels = { index: '语义索引', generate: '补生成', overview: '总体汇总' }
  const structured = (['index', 'generate', 'overview'] as const).map((role) => {
    const { system, responseFormat, runLimit } = structuredAgentConfig(role)
    return {
      id: role,
      label: labels[role],
      systemPrompt: system,
      ...modelDetails(role === 'index' ? 'index' : undefined),
      runLimit,
      tools: responseFormat.map(({ tool }) => ({
        name: tool.function.name,
        description: tool.function.description ?? '',
        schema: tool.function.parameters ?? {}
      }))
    }
  })
  return {
    stages: [
      ...structured,
      {
        id: 'followup',
        label: '追问',
        systemPrompt: FOLLOW_UP_PROMPT,
        ...modelDetails(),
        runLimit: FOLLOW_UP_RUN_LIMIT,
        tools: Object.values(SOURCE_TOOLS).map(({ name, description, schema }) => ({
          name, description, schema: toJsonSchema(schema)
        }))
      },
      {
        id: 'detect',
        label: '语言识别',
        model: detection?.model ?? null,
        systemPrompt: null,
        choice: {
          ...question,
          timeoutMs: detection?.timeout ?? null,
          minConfidence: detection?.minConfidence ?? null
        },
        tools: []
      }
    ]
  }
}
