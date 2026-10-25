// 通知中心：记录消息并标记投递状态。
const inbox = new Map()

export function notify(userId, message) {
  if (!message) {
    return { delivered: false }
  }

  const list = inbox.get(userId) ?? []
  list.push({ message, at: Date.now() })
  inbox.set(userId, list)

  return { delivered: true }
}

export function unread(userId) {
  return (inbox.get(userId) ?? []).length
}
