import { UsageListSchema } from '../domain/usage/schema'
import { getTraceFilePath, isTracingEnabled } from '../ai/observability/trace.sink'
import { readUsageRecords } from '../ai/observability/usage.reader'

export async function listGenerationUsage() {
  return UsageListSchema.parse({
    ...(await readUsageRecords(getTraceFilePath())),
    tracingEnabled: isTracingEnabled()
  })
}
