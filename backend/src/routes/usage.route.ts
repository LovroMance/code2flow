import { Router } from 'express'
import { getGenerationUsage } from '../controllers/usage.controller'

export const usageRouter = Router()
usageRouter.get('/usage', getGenerationUsage)
