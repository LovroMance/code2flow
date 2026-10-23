import express from 'express'
import { registerRoutes } from '../routes'
import { createMultiFileRouter } from '../routes/multifile.route'

export function createApp() {
  const app = express()
  // v2 单独设置 JSON 上限，旧接口继续沿用原有中间件限制。
  app.use('/api/v2', createMultiFileRouter())

  // 允许 200KB 源文件经过 JSON 转义后的请求体，上传限制仍由业务层控制。
  app.use(express.json({ limit: '2mb' }))
  registerRoutes(app)

  return app
}
