import { Router, json, type Request, type Response } from 'express'
import { z } from 'zod'
import { SourceFilesSchema, DraftSchema } from '../domain/source/schema'
import { getMultiFileService, type MultiFileService } from '../services/multifile.service'
import { SessionError } from '../services/session-lock'
import { AnalysisLimitError, ModelConfigurationError } from '../ai/chains/multifile.chain'
import { LanguageDetectionConfigError } from '../ai/clients/jev.client'
import { MultiConfigurationError } from '../services/multifile-config'

const Id = z.string().min(1).max(200)
const params = z.object({ id: Id, snapshotId: Id.optional(), fileId: Id.optional() })
const Generate = z.object({ thread_id: Id, snapshotId: Id })
const Follow = Generate.extend({ question: z.string().trim().min(1).max(4000) })
// 路由只处理 HTTP、SSE、取消和跨边界校验；业务编排交给 service/graph。
export function createMultiFileRouter(service: () => MultiFileService = getMultiFileService) {
  const router = Router()
  router.post(
    '/sessions/:id/snapshots',
    json({ limit: '16mb' }),
    handle(async (req, res) => {
      const p = params.parse(req.params)
      res
        .status(201)
        .json(await service().createSnapshot(p.id, SourceFilesSchema.parse(req.body.files)))
    })
  )
  router.use(json({ limit: '16mb' }))
  router.get(
    '/sessions/:id',
    handle(async (req, res) => {
      res.json(await service().detail(params.parse(req.params).id))
    })
  )
  router.get(
    '/sessions/:id/snapshots/:snapshotId',
    handle(async (req, res) => {
      const p = params.parse(req.params)
      res.json(service().snapshot(p.id, p.snapshotId!))
    })
  )
  router.get(
    '/sessions/:id/snapshots/:snapshotId/files/:fileId',
    handle(async (req, res) => {
      const p = params.parse(req.params)
      res.json(service().file(p.id, p.snapshotId!, p.fileId!))
    })
  )
  router.patch(
    '/sessions/:id/draft',
    handle(async (req, res) => {
      res.json(await service().saveDraft(params.parse(req.params).id, DraftSchema.parse(req.body)))
    })
  )
  router.post(
    '/generate-flow',
    handle(async (req, res) => {
      const input = Generate.parse(req.body)
      service().snapshot(input.thread_id, input.snapshotId)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders()
      const controller = new AbortController(),
        close = () => {
          if (!res.writableEnded) controller.abort()
        }
      res.on('close', close)
      const emit = (type: string, content?: unknown) => {
        if (!controller.signal.aborted && !res.writableEnded)
          res.write(`data: ${JSON.stringify({ type, content })}\n\n`)
      }
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': keep-alive\n\n')
      }, 15000)
      try {
        await service().generate(input.thread_id, input.snapshotId, controller.signal, emit)
      } catch (error) {
        const safe =
          error instanceof AnalysisLimitError ||
          error instanceof ModelConfigurationError ||
          error instanceof MultiConfigurationError ||
          error instanceof LanguageDetectionConfigError ||
          error instanceof SessionError
            ? error.message
            : error instanceof Error &&
                /^(文件索引未完成|局部流程未完成|关系核对未完成|源码覆盖未完成|单元边界冲突)/.test(
                  error.message
                )
              ? error.message
              : controller.signal.aborted
                ? '分析已取消。'
                : '多文件分析未完成，请检查模型配置与预算后重试。'
        emit('error', safe)
      } finally {
        clearInterval(heartbeat)
        res.off('close', close)
        res.end()
      }
    })
  )
  router.post(
    '/follow-up',
    handle(async (req, res) => {
      const input = Follow.parse(req.body),
        controller = new AbortController(),
        close = () => {
          if (!res.writableEnded) controller.abort()
        }
      res.on('close', close)
      try {
        res.json(
          await service().followUp(
            input.thread_id,
            input.snapshotId,
            input.question,
            controller.signal
          )
        )
      } finally {
        res.off('close', close)
      }
    })
  )
  return router
}
function handle(action: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await action(req, res)
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      res
        .status(
          error instanceof SessionError
            ? error.status
            : error instanceof z.ZodError ||
                (error instanceof Error && /文件路径/.test(error.message))
              ? 400
              : 500
        )
        .json({
          error:
            error instanceof SessionError || error instanceof z.ZodError
              ? error.message
              : '多文件请求失败，请检查输入及服务配置。'
        })
    }
  }
}
