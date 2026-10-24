import type { Express } from 'express'
import { healthRouter } from './health.route'
import { flowRouter } from './flow.route'
import { sessionRouter } from './session.route'

export function registerRoutes(app: Express) {
  app.use('/api', healthRouter)
  app.use('/api', flowRouter)
  app.use('/api', sessionRouter)
}
