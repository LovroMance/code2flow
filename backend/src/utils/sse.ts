import type { Response } from 'express'
import type { FlowStreamEvent } from '../domain/flow/types'

export function writeSseEvent(res: Response, event: FlowStreamEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}
