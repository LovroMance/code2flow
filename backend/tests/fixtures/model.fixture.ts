import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
export const code = 'const answer = 42'
type Reply = { toolName: string; args: unknown } | { text: string } | { status: number }
export interface ModelRequest {
  messages: Array<{ role: string; content: string | Array<{ type: 'text'; text: string }> }>
  tools?: unknown[]
}

// 真正经过 ChatOpenAI HTTP + SSE、createAgent 和 StateGraph，仅将外部供应商换成本地确定性服务。
export async function createModelServer(replies: Reply[], overviewReply?: (request: ModelRequest) => Reply) {
  const requests: ModelRequest[] = []
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    for await (const part of req) body += part
    const request: ModelRequest = JSON.parse(body)
    requests.push(request)
    const wantsOverview = request.tools?.some((tool) =>
      (tool as { function?: { name?: string } }).function?.name === 'submit_overview'
    )
    const reply = wantsOverview && overviewReply ? overviewReply(request) : replies.shift() ?? { status: 500 }
    if ('status' in reply) {
      res.writeHead(reply.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'fixture model failure', type: 'test_error' } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta: object, finish_reason: string | null = null, usage?: object) =>
      res.write(
        `data: ${JSON.stringify({
          id: `completion-${requests.length}`,
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek-chat',
          choices: [{ index: 0, delta, finish_reason }],
          usage
        })}\n\n`
      )
    if ('text' in reply) {
      send({ role: 'assistant', content: reply.text })
    } else {
      const args = JSON.stringify(reply.args)
      send({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `call-${requests.length}`,
            type: 'function',
            function: { name: reply.toolName, arguments: '' }
          }
        ]
      })
      for (let i = 0; i < args.length; i += 24) {
        send({ tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 24) } }] })
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
    send({}, 'text' in reply ? 'stop' : 'tool_calls', {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30
    })
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const baseURL = `http://127.0.0.1:${address.port}/v1`
  return {
    requests,
    baseURL,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
  }
}
