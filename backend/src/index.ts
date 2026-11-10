import dotenv from 'dotenv'
import { createApp } from './app/createApp'
import { configureLangSmith } from './ai/observability/langsmith'

dotenv.config()
configureLangSmith()

const port = Number(process.env.PORT)
const app = createApp()

app.listen(port, () => {
  console.log(`Code2Flow backend listening on http://localhost:${port}`)
})
