import dotenv from 'dotenv'
import { createApp } from './app/createApp'
import { getMultiFileService } from './services/multifile.service'

dotenv.config()
console.info('[code-flow][v2] retrieval-readiness', {
  fts5: getMultiFileService().repo.hasFts,
  embeddingConfigured: !!(
    process.env.CODE2FLOW_EMBEDDING_BASE_URL &&
    process.env.CODE2FLOW_EMBEDDING_API_KEY &&
    process.env.CODE2FLOW_EMBEDDING_MODEL
  )
})

const port = Number(process.env.PORT ?? 3000)
const app = createApp()

app.listen(port, () => {
  console.log(`Code2Flow backend listening on http://localhost:${port}`)
})
