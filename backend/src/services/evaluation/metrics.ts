import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { AIMessage } from '@langchain/core/messages'
import type { LLMResult } from '@langchain/core/outputs'

export class EvaluationMetrics extends BaseCallbackHandler {
  name = 'code2flow_evaluation_metrics'
  awaitHandlers = true
  private calls = 0
  private measured = 0
  private completedCalls = 0
  private inputTokens = 0
  private outputTokens = 0
  private totalTokens = 0

  handleLLMEnd(result: LLMResult) {
    this.calls++
    this.completedCalls++
    const usage = result.generations.flat().flatMap((generation) => {
      if (!('message' in generation) || !AIMessage.isInstance(generation.message)) return []
      return generation.message.usage_metadata ? [generation.message.usage_metadata] : []
    })
    if (usage.length === 0) return
    this.measured++
    for (const tokens of usage) {
      this.inputTokens += tokens.input_tokens
      this.outputTokens += tokens.output_tokens
      this.totalTokens += tokens.total_tokens
    }
  }

  handleLLMError() {
    this.calls++
  }

  snapshot() {
    const completeUsage = this.measured === this.completedCalls && this.calls === this.completedCalls
    return {
      modelCalls: this.calls,
      inputTokens: completeUsage ? this.inputTokens : null,
      outputTokens: completeUsage ? this.outputTokens : null,
      totalTokens: completeUsage ? this.totalTokens : null
    }
  }
}
