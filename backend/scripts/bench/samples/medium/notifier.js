// 通知中心：记录投递次数并标记最近一条消息。
let delivered = 0
let lastMessage = ''

export function notify(userId, message) {
  if (!message) {
    return false
  }

  delivered = delivered + 1
  lastMessage = userId + ':' + message

  return true
}

export function stats() {
  return { delivered: delivered, last: lastMessage }
}
