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
    console.log(
      `[code-flow][sse] request-start codeLength=${parsed.data.code.length} threadId=${parsed.data.thread_id ?? 'none'}`
    )

    const result = await streamGenerateFlow(
      {
        code: parsed.data.code,
        threadId: parsed.data.thread_id
      },
      {
        onPartialMermaid: (mermaid) => {
          console.log(
            `[code-flow][sse] send mermaid partial lines=${mermaid.split('\n').length} length=${mermaid.length}`
          )
          writeSseEvent(res, { type: 'mermaid', content: mermaid })
        },
        onDetectedLanguage: (payload) => {
          console.log(
            `[code-flow][sse] send metadata language=${payload.detectedLanguage} confidence=${payload.confidence ?? 'n/a'}`
          )
          writeSseEvent(res, { type: 'metadata', content: payload })
        }
      }
    )

    console.log(`[code-flow][sse] send metadata final language=${result.detectedLanguage}`)
    writeSseEvent(res, {
      type: 'metadata',
      content: { detectedLanguage: result.detectedLanguage }
    })
    console.log(`[code-flow][sse] send mermaid final length=${result.mermaid.length}`)
    writeSseEvent(res, { type: 'mermaid', content: result.mermaid })
    console.log(`[code-flow][sse] send mappings count=${result.mappings.length}`)
    writeSseEvent(res, { type: 'mappings', content: result.mappings })
    console.log('[code-flow][sse] send done')
    writeSseEvent(res, { type: 'done' })
    res.end()
  } catch (error) {
    const message = chineseErrorMessage(error, '流程图分析失败，请稍后重试。')
    console.log(`[code-flow][sse] send error message=${message}`)
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
    console.log(
      `[code-flow][followup] request-start threadId=${parsed.data.thread_id} questionLength=${parsed.data.question.length}`
    )

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
