import type { Request, Response } from 'express'
import { GenerationRequestSchema } from '../domain/flow/schema'
import { generateFlow } from '../services/flow-generation.service'
import { writeSseEvent } from '../utils/sse'

export async function postGenerateFlow(req: Request, res: Response) {
  const parsed = GenerationRequestSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.flatten()
    })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const result = await generateFlow(parsed.data.code)

    writeSseEvent(res, { type: 'mermaid', content: result.mermaid })
    writeSseEvent(res, { type: 'mappings', content: result.mappings })
    writeSseEvent(res, { type: 'done' })
    res.end()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown agent error'
    writeSseEvent(res, { type: 'error', content: message })
    res.end()
  }
}
