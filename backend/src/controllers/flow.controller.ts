import type { Request, Response } from 'express'
import { FollowUpRequestSchema, GenerationRequestSchema } from '../domain/flow/schema'
import { followUpFlow, streamGenerateFlow } from '../services/flow-generation.service'
import { writeSseEvent } from '../utils/sse'
import { chineseErrorMessage, schemaIssueMessage } from '../utils/errorMessage'

export async function postGenerateFlow(req: Request, res: Response) {
  const parsed = GenerationRequestSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      error: '请求参数格式无效。',
      details: parsed.error.flatten((issue) =>
        schemaIssueMessage(issue.code, 'expected' in issue ? issue.expected : undefined)
      )
    })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const result = await streamGenerateFlow(
      {
        code: parsed.data.code,
        threadId: parsed.data.thread_id
      },
      {
        onPartialMermaid: (mermaid) => {
          writeSseEvent(res, { type: 'mermaid', content: mermaid })
        },
        onDetectedLanguage: (payload) => {
          writeSseEvent(res, { type: 'metadata', content: payload })
        }
      }
    )

    writeSseEvent(res, {
      type: 'metadata',
      content: { detectedLanguage: result.detectedLanguage }
    })
    writeSseEvent(res, { type: 'mermaid', content: result.mermaid })
    writeSseEvent(res, { type: 'mappings', content: result.mappings })
    writeSseEvent(res, { type: 'done' })
    res.end()
  } catch (error) {
    const message = chineseErrorMessage(error, '流程图分析失败，请稍后重试。')
    writeSseEvent(res, { type: 'error', content: message })
    res.end()
  }
}

export async function postFollowUpFlow(req: Request, res: Response) {
  const parsed = FollowUpRequestSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      error: '请求参数格式无效。',
      details: parsed.error.flatten((issue) =>
        schemaIssueMessage(issue.code, 'expected' in issue ? issue.expected : undefined)
      )
    })
    return
  }

  try {
    const explanation = await followUpFlow({
      code: parsed.data.code ?? '',
      threadId: parsed.data.thread_id,
      question: parsed.data.question
    })

    res.json({
      thread_id: parsed.data.thread_id,
      question: parsed.data.question,
      explanation
    })
  } catch (error) {
    const message = chineseErrorMessage(error, '追问解释失败，请稍后重试。')

    res.status(400).json({
      error: message
    })
  }
}
