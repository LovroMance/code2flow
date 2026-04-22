import dotenv from 'dotenv'
import { createApp } from './app/createApp'

dotenv.config()

const port = Number(process.env.PORT ?? 3000)
const app = createApp()

app.listen(port, () => {
  console.log(`Code2Flow backend listening on http://localhost:${port}`)
})
