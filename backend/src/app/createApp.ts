import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { registerRoutes } from '../routes'
import { createMultiFileRouter } from '../routes/multifile.route'

export function createApp() {
  const app = express()
  // 源码接口在路由内设置 JSON 上限，会话目录使用通用解析器。
  app.use('/api/v2', createMultiFileRouter())

  app.use(express.json({ limit: '2mb' }))
  registerRoutes(app)

  // JSON 中间件与未知接口的默认响应为英文 HTML，统一为中文 JSON。
  app.use((_req, res) => res.status(404).json({ error: '请求的接口不存在，请检查地址。' }))
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error)
      return
    }
    const status =
      error && typeof error === 'object' && 'status' in error ? error.status : undefined
    res.status(status === 413 ? 413 : status === 400 ? 400 : 500).json({
      error:
        status === 413
          ? '请求内容过大，请减少上传文件数量或大小。'
          : status === 400
            ? '请求内容格式无效，请检查 JSON 格式。'
            : '服务器处理请求失败，请稍后重试。'
    })
  })

  return app
}
