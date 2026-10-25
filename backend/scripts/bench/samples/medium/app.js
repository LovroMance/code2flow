import { applyDiscount } from './discount.js'
import { notify } from './notifier.js'

// 入口：计算折后金额并通知用户。
export function checkout(user, amount) {
  if (amount <= 0) {
    return { ok: false }
  }

  const total = applyDiscount(user, amount)
  notify(user.id, 'checkout-done')

  return { ok: true, total: total }
}
