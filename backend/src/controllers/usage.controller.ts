import type { Request, Response } from 'express'
import { listGenerationUsage } from '../services/usage.service'

export async function getGenerationUsage(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    res.json(await listGenerationUsage())
  } catch {
    res.status(500).json({ error: '读取用量记录失败，请稍后重试' })
  }
}
