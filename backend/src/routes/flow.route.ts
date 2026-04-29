import { Router } from 'express'
import { postFollowUpFlow, postGenerateFlow } from '../controllers/flow.controller'

export const flowRouter = Router()

flowRouter.post('/generate-flow', postGenerateFlow)
flowRouter.post('/follow-up', postFollowUpFlow)
