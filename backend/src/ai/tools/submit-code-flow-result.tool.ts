import { GenerationResultSchema } from '../../domain/flow/schema'

export const SUBMIT_CODE_FLOW_RESULT_TOOL_NAME = 'submit_code_flow_result'

export const submitCodeFlowResultTool = {
  name: SUBMIT_CODE_FLOW_RESULT_TOOL_NAME,
  description:
    'Submit the final structured code-flow analysis result after language detection is complete.',
  schema: GenerationResultSchema
}
