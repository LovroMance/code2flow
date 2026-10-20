import type { SupportedLanguage } from '../domain/flow/types'

// 评估样例。expectation 里的字段都是"程序可判定"的，主观质量另走 LLM 裁判。
export interface EvalCase {
  id: string
  name: string
  language: SupportedLanguage
  code: string
  tags: string[]
  expectation: EvalExpectation
}

// 期望值刻意保持宽松：只断言"必须出现/不能出现"，不锁死具体节点数，否则极易误报。
export interface EvalExpectation {
  mustHaveKinds?: string[]
  mustContainLabels?: string[]
  forbiddenLabels?: string[]
  minMappings?: number
  maxMappings?: number
  validLineRange?: boolean
}

export interface EvalDataset {
  name: string
  cases: EvalCase[]
}
