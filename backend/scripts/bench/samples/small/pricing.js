import { isVipUser } from './order.js'

// 汇总商品金额，再调用订单模块判断是否打折。
export function calculateTotal(user, items) {
  let total = 0

  for (const item of items) {
    total += item.price * item.quantity
  }

  if (isVipUser(user)) {
    total *= 0.8
  }

  return Math.round(total * 100) / 100
}
