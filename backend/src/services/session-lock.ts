const activeThreads = new Set<string>()

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export function isSessionBusy(id: string) {
  return activeThreads.has(id)
}

// 同一线程的写操作串行互斥，避免生成、追问与删除交错写入检查点。
export async function withSessionLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (activeThreads.has(id)) throw new SessionError('该会话正在处理请求，请完成后重试。', 409)
  activeThreads.add(id)
  try {
    return await action()
  } finally {
    activeThreads.delete(id)
  }
}
