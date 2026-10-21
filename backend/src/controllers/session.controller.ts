import type { Request, Response } from 'express'
import { z } from 'zod'
import { SessionCreateSchema, SessionIdSchema, SessionWriteSchema } from '../domain/session/schema'
import { getSessionService } from '../services/session.service'
import { SessionError } from '../services/session-lock'

async function respond(res: Response, action: () => Promise<unknown>, status = 200) {
  try {
    const data = await action()
    if (status === 204) res.status(204).end()
    else res.status(status).json(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '会话参数格式无效。' })
    } else if (error instanceof SessionError) {
      res.status(error.status).json({ error: error.message })
    } else {
      console.error('[code-flow][sessions] request-failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError'
      })
      res.status(500).json({ error: '会话操作失败，请稍后重试。' })
    }
  }
}

export const listSessions = (_req: Request, res: Response) =>
  respond(res, async () => ({ sessions: await getSessionService().list() }))
export const getSession = (req: Request, res: Response) =>
  respond(res, () => getSessionService().get(SessionIdSchema.parse(req.params.id)))
export const createSession = (req: Request, res: Response) =>
  respond(res, () => getSessionService().create(SessionCreateSchema.parse(req.body)), 201)
export const updateSession = (req: Request, res: Response) =>
  respond(res, () =>
    getSessionService().update(
      SessionIdSchema.parse(req.params.id),
      SessionWriteSchema.parse(req.body)
    )
  )
export const deleteSession = (req: Request, res: Response) =>
  respond(res, () => getSessionService().delete(SessionIdSchema.parse(req.params.id)), 204)
