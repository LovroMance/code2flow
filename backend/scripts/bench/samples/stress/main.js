import { Cart } from './cart.js'
import { applyDiscount } from './discount.js'
import { notify } from './notifier.js'
import { buildReport } from './report.js'

// 入口：组装购物车、计算折扣、发送通知并产出报表。
export function checkout(store, userId, items) {
  if (items.length === 0) {
    return { ok: false, reason: 'empty-items' }
  }

  const cart = new Cart(userId)
  for (const item of items) {
    cart.add(item.sku, item.price, item.quantity)
  }

  const subtotal = cart.subtotal()
  const total = applyDiscount(subtotal, userId)

  if (total <= 0) {
    return { ok: false, reason: 'invalid-total' }
  }

  const message = 'order-created'
  notify(userId, message)

  buildReport(store, cart, total)

  return { ok: true, total: total }
}
