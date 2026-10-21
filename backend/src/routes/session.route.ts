import { Router } from 'express'
import {
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession
} from '../controllers/session.controller'

export const sessionRouter = Router()
sessionRouter.get('/sessions', listSessions)
sessionRouter.post('/sessions', createSession)
sessionRouter.get('/sessions/:id', getSession)
sessionRouter.patch('/sessions/:id', updateSession)
sessionRouter.delete('/sessions/:id', deleteSession)
