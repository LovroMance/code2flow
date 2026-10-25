import { calculateQuote, calculateRefund, compareShippingPlans, explainQuote } from './pricing.js'

// 订单模块负责校验、库存、订单状态及售后；价格模块会反向调用本模块的资格判断。
// 所有数据只在内存中处理，不请求服务、不读写文件。
export function isVipUser(user) {
  if (!user || user.disabled === true) {
    return false
  }
  if (user.level === 'vip' || user.level === 'enterprise') {
    return true
  }
  return Number(user.points || 0) >= 5000
}

export function resolveCustomerTier(user) {
  if (!user || user.disabled) {
    return 'blocked'
  }
  if (user.level === 'enterprise') {
    return 'enterprise'
  }
  if (isVipUser(user)) {
    return 'vip'
  }
  return 'regular'
}

export function canUseCoupon(user, coupon, items) {
  if (!coupon || coupon.disabled || !user || user.disabled) {
    return false
  }
  if (coupon.vipOnly && !isVipUser(user)) {
    return false
  }
  if (coupon.ownerId && coupon.ownerId !== user.id) {
    return false
  }
  if (coupon.category) {
    return items.some((item) => item.category === coupon.category)
  }
  return true
}

export function getShippingRegion(address) {
  if (!address || !address.province) {
    return 'unknown'
  }
  switch (address.province) {
    case '新疆':
    case '西藏':
      return 'remote'
    case '浙江':
    case '江苏':
    case '上海':
      return 'nearby'
    default:
      return 'standard'
  }
}

export function isReturnableItem(item) {
  if (!item || item.digital || item.customized) {
    return false
  }
  return item.returnable !== false
}

function validateCustomer(user) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) {
    throw new Error('用户标识不能为空')
  }
  if (resolveCustomerTier(user) === 'blocked') {
    throw new Error('用户已被禁用')
  }
}

function validateAddress(address, items) {
  if (items.every((item) => item.digital)) {
    return
  }
  if (!address || !address.province || !address.detail) {
    throw new Error('实物订单必须提供完整收货地址')
  }
  if (!/^1\d{10}$/.test(address.phone || '')) {
    throw new Error('收货手机号格式错误')
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('订单不能为空')
  }
  const merged = new Map()
  for (const item of items) {
    if (!item || typeof item.sku !== 'string' || !item.sku.trim()) {
      throw new Error('商品编号不能为空')
    }
    if (!Number.isFinite(item.price) || item.price < 0) {
      throw new Error(`商品 ${item.sku} 价格无效`)
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`商品 ${item.sku} 数量无效`)
    }
    const previous = merged.get(item.sku)
    if (previous) {
      if (previous.price !== item.price) {
        throw new Error(`商品 ${item.sku} 存在不同价格`)
      }
      previous.quantity += item.quantity
      continue
    }
    merged.set(item.sku, {
      ...item,
      weight: Number.isFinite(item.weight) ? Math.max(0, item.weight) : 0
    })
  }
  return [...merged.values()]
}

function reserveInventory(items, inventory) {
  const reservations = []
  try {
    for (const item of items) {
      if (item.digital) {
        continue
      }
      const available = inventory.get(item.sku) || 0
      if (available < item.quantity) {
        throw new Error(`商品 ${item.sku} 库存不足`)
      }
      inventory.set(item.sku, available - item.quantity)
      reservations.push({ sku: item.sku, quantity: item.quantity })
    }
    return reservations
  } catch (error) {
    releaseInventory(reservations, inventory)
    throw error
  }
}

function releaseInventory(reservations, inventory) {
  for (const reservation of reservations) {
    const current = inventory.get(reservation.sku) || 0
    inventory.set(reservation.sku, current + reservation.quantity)
  }
}

function recordEvent(order, type, detail, now) {
  order.events.push({ type, detail, at: now })
}

// createOrder → calculateQuote → 会员、优惠券和收货区域判断，形成跨模块往返调用。
export function createOrder(user, items, options = {}) {
  const inventory = options.inventory || new Map()
  const now = options.now ?? Date.now()
  let reservations = []
  try {
    validateCustomer(user)
    const normalized = normalizeItems(items)
    validateAddress(options.address, normalized)
    const quote = calculateQuote(user, normalized, options)
    if (quote.payable <= 0) {
      throw new Error('订单金额必须大于零')
    }
    reservations = reserveInventory(normalized, inventory)
    const order = {
      id: options.orderId || `order-${user.id}-${now}`,
      userId: user.id,
      status: 'pending',
      items: normalized,
      address: options.address ? { ...options.address } : null,
      quote,
      reservations,
      events: [],
      refundedQuantities: {},
      refundedCents: 0,
      createdAt: now,
      expiresAt: now + 30 * 60 * 1000
    }
    recordEvent(order, 'created', explainQuote(quote), now)
    return { success: true, order }
  } catch (error) {
    releaseInventory(reservations, inventory)
    return { success: false, message: error.message }
  }
}

export function previewOrder(user, items, options = {}) {
  try {
    validateCustomer(user)
    const normalized = normalizeItems(items)
    validateAddress(options.address, normalized)
    return {
      success: true,
      quote: calculateQuote(user, normalized, options),
      shippingPlans: compareShippingPlans(user, normalized, options.address)
    }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

export function payOrder(order, payment, now = Date.now()) {
  if (order.status === 'paid' && order.paymentId === payment.id) {
    return { success: true, repeated: true }
  }
  if (order.status !== 'pending') {
    return { success: false, message: '当前状态不可支付' }
  }
  if (now >= order.expiresAt) {
    return { success: false, message: '订单已超时，请先关闭订单' }
  }
  if (!payment.id || !Number.isFinite(payment.amount)) {
    return { success: false, message: '支付参数无效' }
  }
  if (Math.round(payment.amount * 100) !== order.quote.payableCents) {
    return { success: false, message: '支付金额不匹配' }
  }
  order.status = 'paid'
  order.paymentId = payment.id
  recordEvent(order, 'paid', payment.id, now)
  return { success: true, repeated: false }
}

export function cancelOrder(order, inventory, reason, now = Date.now()) {
  if (order.status === 'cancelled') {
    return { success: true, repeated: true }
  }
  if (order.status !== 'pending') {
    return { success: false, message: '仅待支付订单可取消' }
  }
  releaseInventory(order.reservations, inventory)
  order.reservations = []
  order.status = 'cancelled'
  recordEvent(order, 'cancelled', reason || '用户取消', now)
  return { success: true, repeated: false }
}

export function closeExpiredOrders(orders, inventory, now = Date.now()) {
  const result = { closed: [], skipped: [], failed: [] }
  for (const order of orders) {
    if (order.status !== 'pending' || now < order.expiresAt) {
      result.skipped.push(order.id)
      continue
    }
    try {
      const response = cancelOrder(order, inventory, '支付超时', now)
      if (response.success) {
        result.closed.push(order.id)
      } else {
        result.failed.push({ id: order.id, message: response.message })
      }
    } catch (error) {
      result.failed.push({ id: order.id, message: error.message })
    }
  }
  return result
}

export function shipOrder(order, tracking, now = Date.now()) {
  if (order.status !== 'paid') {
    return { success: false, message: '仅已支付订单可发货' }
  }
  if (!tracking.carrier || !tracking.number) {
    return { success: false, message: '物流信息不完整' }
  }
  order.status = 'shipped'
  order.tracking = { ...tracking }
  recordEvent(order, 'shipped', tracking.number, now)
  return { success: true }
}

// 退款价格反向引用本模块的退货资格，仍然基于原订单的成交价格。
export function requestRefund(order, requests, inventory, now = Date.now()) {
  if (!['paid', 'shipped', 'partially_refunded'].includes(order.status)) {
    return { success: false, message: '当前状态不可退款' }
  }
  try {
    const refund = calculateRefund(order, requests)
    if (refund.refundCents <= 0) {
      return { success: false, message: '没有可退款金额' }
    }
    for (const line of refund.lines) {
      order.refundedQuantities[line.sku] = (order.refundedQuantities[line.sku] || 0) + line.quantity
      const item = order.items.find((entry) => entry.sku === line.sku)
      if (!item.digital) {
        inventory.set(line.sku, (inventory.get(line.sku) || 0) + line.quantity)
      }
    }
    order.refundedCents += refund.refundCents
    const allReturned = order.items.every(
      (item) => (order.refundedQuantities[item.sku] || 0) === item.quantity
    )
    order.status = allReturned ? 'refunded' : 'partially_refunded'
    recordEvent(order, 'refunded', `${refund.refundCents}分`, now)
    return { success: true, refund }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

export function summarizeOrders(orders) {
  const summary = { count: orders.length, byStatus: {}, paidCents: 0, refundedCents: 0 }
  for (const order of orders) {
    summary.byStatus[order.status] = (summary.byStatus[order.status] || 0) + 1
    switch (order.status) {
      case 'paid':
      case 'shipped':
      case 'partially_refunded':
      case 'refunded':
        summary.paidCents += order.quote.payableCents
        summary.refundedCents += order.refundedCents
        break
      default:
        break
    }
  }
  return { ...summary, netCents: summary.paidCents - summary.refundedCents }
}
