import type { FlowStreamEvent } from '../../entities/flow/model/types'

export async function streamGenerateFlow(code: string, onEvent: (event: FlowStreamEvent) => void) {
  console.log(`[code-flow][frontend][stream] request-start codeLength=${code.length}`)

  const response = await fetch('/api/generate-flow', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code })
  })

  if (!response.ok || !response.body) {
    throw new Error('请求失败，无法读取后端返回。')
  }

  console.log('[code-flow][frontend][stream] response-opened')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const chunk of events) {
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '))

      if (!dataLine) {
        continue
      }

      const event = JSON.parse(dataLine.slice(6)) as FlowStreamEvent
      console.log(`[code-flow][frontend][stream] event=${event.type}`)
      onEvent(event)
    }
  }

  console.log('[code-flow][frontend][stream] response-complete')
}
