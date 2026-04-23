import type { Request, Response } from 'express'
import { GenerationRequestSchema } from '../domain/flow/schema'
import { streamGenerateFlow } from '../services/flow-generation.service'
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
    console.log(
      `[code-flow][sse] request-start codeLength=${parsed.data.code.length} threadId=${parsed.data.thread_id ?? 'none'}`
    )

    const result = await streamGenerateFlow(parsed.data.code, (mermaid) => {
      console.log(
        `[code-flow][sse] send mermaid partial lines=${mermaid.split('\n').length} length=${mermaid.length}`
      )
      writeSseEvent(res, { type: 'mermaid', content: mermaid })
    })

    console.log(`[code-flow][sse] send mermaid final length=${result.mermaid.length}`)
    writeSseEvent(res, { type: 'mermaid', content: result.mermaid })
    console.log(`[code-flow][sse] send mappings count=${result.mappings.length}`)
    writeSseEvent(res, { type: 'mappings', content: result.mappings })
    console.log('[code-flow][sse] send done')
    writeSseEvent(res, { type: 'done' })
    res.end()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown agent error'
    console.log(`[code-flow][sse] send error message=${message}`)
    writeSseEvent(res, { type: 'error', content: message })
    res.end()
  }
}
