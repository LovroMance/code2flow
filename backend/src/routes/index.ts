import type { Express } from 'express'
import { healthRouter } from './health.route'
import { flowRouter } from './flow.route'

export function registerRoutes(app: Express) {
  app.use('/api', healthRouter)
  app.use('/api', flowRouter)
}
