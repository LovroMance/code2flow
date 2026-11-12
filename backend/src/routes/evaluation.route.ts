import { Router } from 'express'
import { z } from 'zod'
import { getCurrentRun, getDatasets, getRuns, startRun } from '../services/evaluation/evaluation.service'
import { EvaluationTraceNotFound, getSampleTraceUrl } from '../services/evaluation/trace.service'
import { getAgentConfiguration } from '../services/evaluation/agent-config'
import { chineseErrorMessage } from '../utils/errorMessage'

export const evaluationRouter = Router()
const datasetIdSchema = z.uuid()
const runInput = z.object({ datasetId: datasetIdSchema, name: z.string().trim().max(80).default('') })

function remoteError(error: unknown) {
  if (error instanceof Error && error.message.startsWith('请在后端配置')) return error.message
  return chineseErrorMessage(error, '读取 LangSmith 失败，请检查后端配置、工作区权限和网络。', false)
}

function traceError(error: unknown) {
  if (error instanceof EvaluationTraceNotFound) return { status: 404, message: error.message }
  return { status: 502, message: remoteError(error) }
}

evaluationRouter.get('/agent-config', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(getAgentConfiguration())
})

evaluationRouter.get('/datasets', async (_req, res) => {
  try {
    res.json(await getDatasets())
  } catch (error) {
    res.status(502).json({ error: remoteError(error) })
  }
})

evaluationRouter.get('/datasets/:id/runs', async (req, res) => {
  const id = datasetIdSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: '数据集 ID 无效。' })
  try {
    res.json(await getRuns(id.data))
  } catch (error) {
    res.status(502).json({ error: remoteError(error) })
  }
})

evaluationRouter.get('/datasets/:id/current', (req, res) => {
  res.set('Cache-Control', 'no-store').json(getCurrentRun(req.params.id))
})

evaluationRouter.get('/experiments/:id/samples/:index/trace', async (req, res) => {
  const params = z.object({ id: z.uuid(), index: z.coerce.number().int().nonnegative() }).safeParse(req.params)
  if (!params.success) return res.status(400).json({ error: '实验或样本参数无效。' })
  res.set('Cache-Control', 'no-store')
  try {
    res.redirect(await getSampleTraceUrl(params.data.id, params.data.index))
  } catch (error) {
    const failure = traceError(error)
    res.status(failure.status).json({ error: failure.message })
  }
})

evaluationRouter.post('/runs', (req, res) => {
  const input = runInput.safeParse(req.body)
  if (!input.success) return res.status(400).json({ error: '请选择数据集，实验名称最多 80 字。' })
  const run = startRun(input.data.datasetId, input.data.name)
  if (!run) return res.status(409).json({ error: '已有评测正在运行，请等它完成后重试。' })
  res.status(202).json(run)
})
