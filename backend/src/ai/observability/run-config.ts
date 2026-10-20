import { createHash } from 'node:crypto'

// 一次运行的配置指纹：A/B 实验时靠它把结果分组，也是可复现性的依据。
export interface ResolvedRunConfig {
  provider: string
  promptVariant: string
  model: string
  temperature: number
  maxRetries: number
  configHash: string
}

// 环境变量读取统一收口，避免业务代码散落 process.env 并各自给默认值。
export function resolveRunConfig(input?: { maxRetries?: number }): ResolvedRunConfig {
  const provider = 'graph'
  const promptVariant = process.env.CODE2FLOW_PROMPT_VARIANT ?? 'baseline'
  const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
  const temperature = Number(process.env.DEEPSEEK_TEMPERATURE ?? 0)
  const maxRetries = input?.maxRetries ?? Number(process.env.CODE2FLOW_MAX_RETRIES ?? 1)
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new Error('CODE2FLOW_MAX_RETRIES must be an integer between 0 and 10')
  }

  return {
    provider,
    promptVariant,
    model,
    temperature,
    maxRetries,
    // 只对影响输出的变量做哈希，PORT 之类的运行环境变量不参与。
    configHash: hashConfig({ provider, promptVariant, model, temperature, maxRetries })
  }
}

function hashConfig(config: Omit<ResolvedRunConfig, 'configHash'>) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12)
}

// 代码指纹用于判断"同一条样例是否换了输入"，不存明文源码。
export function hashCode(code: string) {
  return createHash('sha256').update(code.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
}
