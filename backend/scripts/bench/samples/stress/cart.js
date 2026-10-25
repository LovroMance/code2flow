// 购物车：登记商品并汇总小计。
export class Cart {
  constructor(userId) {
    this.userId = userId
    this.lines = []
  }

  add(sku, price, quantity) {
    if (quantity <= 0) {
      return false
    }
    this.lines.push({ sku, price, quantity })
    return true
  }

  subtotal() {
    let sum = 0
    for (const line of this.lines) {
      sum += line.price * line.quantity
    }
    return sum
  }

  count() {
    return this.lines.reduce((n, line) => n + line.quantity, 0)
  }
}
