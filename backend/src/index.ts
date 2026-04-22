import express from 'express'
import { createAgent } from './agent'
import { GenerationRequestSchema } from './types'

const app = express()
const port = Number(process.env.PORT ?? 3000)

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'code2flow-backend' })
})

app.post('/api/generate-flow', async (req, res) => {
  const parsed = GenerationRequestSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.flatten()
    })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const agent = createAgent()
  const result = await agent.generate(parsed.data.code)

  res.write(`data: ${JSON.stringify({ type: 'mermaid', content: result.mermaid })}\n\n`)
  res.write(`data: ${JSON.stringify({ type: 'mappings', content: result.mappings })}\n\n`)
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
  res.end()
})

app.listen(port, () => {
  console.log(`Code2Flow backend listening on http://localhost:${port}`)
})
