import { calculateTotal } from './pricing.js'

// pricing.js 会调用这个函数，判断用户是否享受会员折扣。
export function isVipUser(user) {
  return user.level === 'vip'
}

// 订单模块调用价格模块，价格模块再调用订单模块的会员判断。
export function createOrder(user, items) {
  if (items.length === 0) {
    return { success: false, message: '订单不能为空' }
  }

  const total = calculateTotal(user, items)

  if (total <= 0) {
    return { success: false, message: '订单金额必须大于零' }
  }

  return { success: true, total }
}
