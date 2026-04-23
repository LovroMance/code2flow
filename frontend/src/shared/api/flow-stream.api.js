export async function streamGenerateFlow(code, onEvent) {
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
      onEvent(JSON.parse(dataLine.slice(6)))
    }
  }
}
