import { calculateTotal } from './pricing.js'

// 会员折扣包装：先算原价，再按会员等级打折。
export function applyDiscount(subtotal, user) {
  if (subtotal <= 0) {
    return 0
  }

  const lines = normalizeLines(subtotal)
  const base = calculateTotal(user, lines)

  if (user.level === 'vip') {
    return Math.round(base * 0.9 * 100) / 100
  }

  return base
}

// 将小计包装为 pricing 可用的行项目结构。
function normalizeLines(subtotal) {
  return [{ price: subtotal, quantity: 1 }]
}
