import express from 'express'
import { registerRoutes } from '../routes'

export function createApp() {
  const app = express()

  // 允许 200KB 源文件经过 JSON 转义后的请求体，上传限制仍由业务层控制。
  app.use(express.json({ limit: '2mb' }))
  registerRoutes(app)

  return app
}
