// 汇总商品金额，会员额外乘以折扣系数。
export function calculateTotal(user, items) {
  let total = 0

  for (const item of items) {
    total += item.price * item.quantity
  }

  if (user.level === 'vip') {
    total *= 0.8
  }

  return Math.round(total * 100) / 100
}
