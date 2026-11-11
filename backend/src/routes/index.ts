import type { Express } from 'express'
import { healthRouter } from './health.route'
import { sessionRouter } from './session.route'
import { evaluationRouter } from './evaluation.route'

export function registerRoutes(app: Express) {
  app.use('/api', healthRouter)
  app.use('/api', sessionRouter)
  app.use('/api/evaluations', evaluationRouter)
}
