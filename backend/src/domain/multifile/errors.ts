/** 只有明确来自模型提交的格式、范围或证据错误，才允许 graph 重试。 */
export class ModelOutputValidationError extends Error {}

/** 输出截断不是可原样重试的字段错误。 */
export class ModelOutputTruncatedError extends Error {}

/** LangChain 可能包装异常，按身份展开，禁止丢失预算、截断和程序错误。 */
export function errorCauses(error: unknown): unknown[] {
  const result: unknown[] = []
  const seen = new Set<object>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current) && result.length < 10) {
    result.push(current)
    seen.add(current)
    current = 'cause' in current ? current.cause : undefined
  }
  return result
}
