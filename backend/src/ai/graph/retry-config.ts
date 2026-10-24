/** 重试配置属于图的业务约束，独立于追踪平台，防止无界重试。 */
export function resolveMaxRetries(value?: number): number {
  const maxRetries = value ?? Number(process.env.CODE2FLOW_MAX_RETRIES ?? 1)
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10)
    throw new Error('重试次数配置 CODE2FLOW_MAX_RETRIES 必须是 0 到 10 之间的整数。')
  return maxRetries
}
