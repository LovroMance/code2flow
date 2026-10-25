import {
  canUseCoupon,
  getShippingRegion,
  isReturnableItem,
  isVipUser,
  resolveCustomerTier
} from './order.js'

// 金额内部使用整数分；模块顶层不调用导入函数，避免循环依赖初始化时访问未就绪数据。
function toCents(amount) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('金额必须是非负有限数字')
  }
  const cents = Math.round(amount * 100)
  if (!Number.isSafeInteger(cents)) {
    throw new Error('金额超出安全范围')
  }
  return cents
}

function assertSafeCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error('累计金额超出安全范围')
  }
  return cents
}

function buildPriceLines(items) {
  const lines = []
  for (const item of items) {
    const unitCents = toCents(item.price)
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`商品 ${item.sku} 数量无效`)
    }
    lines.push({
      sku: item.sku,
      category: item.category || 'general',
      quantity: item.quantity,
      unitCents,
      originalCents: assertSafeCents(unitCents * item.quantity),
      payableCents: assertSafeCents(unitCents * item.quantity),
      discounts: []
    })
  }
  return lines
}

function totalOf(lines) {
  let total = 0
  for (const line of lines) {
    total = assertSafeCents(total + line.payableCents)
  }
  return total
}

// 将优惠按余额比例分摊，最后一项吸收舍入差额，确保总额严格一致。
function distributeDiscount(lines, requestedCents, type) {
  const total = totalOf(lines)
  const discount = Math.min(total, assertSafeCents(requestedCents))
  if (total === 0 || discount === 0) {
    return 0
  }
  let remainingDiscount = discount
  let remainingBase = total
  for (const line of lines) {
    const base = line.payableCents
    if (base === 0) {
      continue
    }
    const share =
      remainingBase === base
        ? remainingDiscount
        : Math.floor(remainingDiscount * (base / remainingBase))
    line.payableCents -= share
    line.discounts.push({ type, cents: share })
    remainingDiscount -= share
    remainingBase -= base
  }
  return discount
}

function applyMemberDiscount(user, lines) {
  const tier = resolveCustomerTier(user)
  let rate
  switch (tier) {
    case 'enterprise':
      rate = 0.15
      break
    case 'vip':
      rate = 0.08
      break
    case 'blocked':
      throw new Error('禁用用户不能参与计价')
    default:
      rate = 0
  }
  return distributeDiscount(lines, Math.floor(totalOf(lines) * rate), 'member')
}

function applyBulkDiscount(lines) {
  const eligible = []
  for (const line of lines) {
    if (line.category === 'gift-card') {
      continue
    }
    if (line.quantity >= 10) {
      eligible.push(line)
    }
  }
  const discount = Math.floor(totalOf(eligible) * 0.03)
  return distributeDiscount(eligible, discount, 'bulk')
}

function applyCoupon(user, items, lines, coupon, now) {
  if (!coupon) {
    return { applied: false, cents: 0, reason: '未使用优惠券' }
  }
  if (!canUseCoupon(user, coupon, items)) {
    return { applied: false, cents: 0, reason: '不满足优惠券使用资格' }
  }
  if (coupon.expiresAt !== undefined && now >= coupon.expiresAt) {
    return { applied: false, cents: 0, reason: '优惠券已过期' }
  }
  const eligible = lines.filter((line) => !coupon.category || line.category === coupon.category)
  const subtotal = totalOf(eligible)
  if (subtotal < toCents(coupon.minimum || 0)) {
    return { applied: false, cents: 0, reason: '未达到优惠券门槛' }
  }
  let requested
  switch (coupon.type) {
    case 'fixed':
      requested = toCents(coupon.amount)
      break
    case 'percentage':
      if (!Number.isFinite(coupon.rate) || coupon.rate <= 0 || coupon.rate > 1) {
        throw new Error('优惠券折扣比例无效')
      }
      requested = Math.floor(subtotal * coupon.rate)
      if (coupon.maximum !== undefined) {
        requested = Math.min(requested, toCents(coupon.maximum))
      }
      break
    default:
      return { applied: false, cents: 0, reason: '不支持的优惠券类型' }
  }
  const cents = distributeDiscount(eligible, requested, 'coupon')
  return { applied: cents > 0, cents, reason: cents > 0 ? '优惠券已生效' : '无可抵扣金额' }
}

function applyPoints(user, lines, requestedPoints) {
  if (!Number.isInteger(requestedPoints) || requestedPoints < 0) {
    throw new Error('使用积分必须是非负整数')
  }
  const available = Number.isSafeInteger(user.points) && user.points > 0 ? user.points : 0
  const usable = Math.min(available, requestedPoints)
  const limit = Math.floor(totalOf(lines) * 0.2)
  const cents = distributeDiscount(lines, Math.min(usable, limit), 'points')
  return { spent: cents, cents }
}

function calculateShipping(user, items, address, subtotalCents, mode) {
  const physical = items.filter((item) => !item.digital)
  if (physical.length === 0) {
    return { mode, cents: 0, region: 'digital', reason: '虚拟商品免运费' }
  }
  const region = getShippingRegion(address)
  if (region === 'unknown') {
    throw new Error('无法计算未知收货区域的运费')
  }
  if (mode !== 'standard' && mode !== 'express') {
    throw new Error('不支持的配送方式')
  }
  let weight = 0
  for (const item of physical) {
    weight += item.weight * item.quantity
  }
  const extraWeight = Math.max(0, Math.ceil(weight - 1))
  let cents
  switch (region) {
    case 'nearby':
      cents = 600 + extraWeight * 100
      break
    case 'remote':
      cents = 1800 + extraWeight * 500
      break
    default:
      cents = 1000 + extraWeight * 200
  }
  if (mode === 'express') {
    cents += 1200
  }
  if (region !== 'remote' && mode === 'standard') {
    if (isVipUser(user) || subtotalCents >= 19900) {
      return { mode, cents: 0, region, reason: '会员或满额免运费' }
    }
  }
  return { mode, cents: assertSafeCents(cents), region, reason: '按区域和重量计费' }
}

export function compareShippingPlans(user, items, address) {
  const lines = buildPriceLines(items)
  const subtotal = totalOf(lines)
  const plans = []
  for (const mode of ['standard', 'express']) {
    try {
      plans.push(calculateShipping(user, items, address, subtotal, mode))
    } catch (error) {
      plans.push({ mode, available: false, reason: error.message })
    }
  }
  return plans
}

// 计价依次应用会员、批量、优惠券和积分，再计算运费；所有优惠保留分摊结果供退款使用。
export function calculateQuote(user, items, options = {}) {
  const lines = buildPriceLines(items)
  const originalCents = totalOf(lines)
  const memberCents = applyMemberDiscount(user, lines)
  const bulkCents = applyBulkDiscount(lines)
  const coupon = applyCoupon(user, items, lines, options.coupon, options.now ?? Date.now())
  const points = applyPoints(user, lines, options.usePoints ?? 0)
  const goodsCents = totalOf(lines)
  const shipping = calculateShipping(
    user,
    items,
    options.address,
    goodsCents,
    options.shippingMode || 'standard'
  )
  const payableCents = assertSafeCents(goodsCents + shipping.cents)
  return {
    lines,
    originalCents,
    goodsCents,
    memberCents,
    bulkCents,
    coupon,
    points,
    shipping,
    payableCents,
    payable: payableCents / 100,
    discountCents: originalCents - goodsCents
  }
}

function normalizeRefundRequests(requests) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('退款商品不能为空')
  }
  const merged = new Map()
  for (const request of requests) {
    if (!Number.isInteger(request.quantity) || request.quantity <= 0) {
      throw new Error('退款数量必须为正整数')
    }
    merged.set(request.sku, (merged.get(request.sku) || 0) + request.quantity)
  }
  return [...merged].map(([sku, quantity]) => ({ sku, quantity }))
}

// 使用累计已退数量分摊尾差，避免多次部分退款后多退或少退一分钱；运费不退。
export function calculateRefund(order, requests) {
  const normalized = normalizeRefundRequests(requests)
  const lines = []
  let refundCents = 0
  for (const request of normalized) {
    const item = order.items.find((entry) => entry.sku === request.sku)
    if (!item) {
      throw new Error(`订单中没有商品 ${request.sku}`)
    }
    if (!isReturnableItem(item)) {
      throw new Error(`商品 ${request.sku} 不支持退货`)
    }
    const priceLine = order.quote.lines.find((entry) => entry.sku === request.sku)
    if (!priceLine) {
      throw new Error('原始成交价格缺失')
    }
    const returned = order.refundedQuantities[request.sku] || 0
    if (returned + request.quantity > item.quantity) {
      throw new Error(`商品 ${request.sku} 退款数量超过剩余数量`)
    }
    const before = Math.floor(priceLine.payableCents * (returned / item.quantity))
    const after = Math.floor(
      priceLine.payableCents * ((returned + request.quantity) / item.quantity)
    )
    const cents = after - before
    refundCents = assertSafeCents(refundCents + cents)
    lines.push({ sku: request.sku, quantity: request.quantity, cents })
  }
  if (order.refundedCents + refundCents > order.quote.goodsCents) {
    throw new Error('累计退款超过商品成交金额')
  }
  return { lines, refundCents, refund: refundCents / 100 }
}

export function explainQuote(quote) {
  const parts = [`商品原价 ${formatMoney(quote.originalCents)}`]
  const discounts = [
    ['会员优惠', quote.memberCents],
    ['批量优惠', quote.bulkCents],
    ['优惠券', quote.coupon.cents],
    ['积分抵扣', quote.points.cents]
  ]
  for (const [label, cents] of discounts) {
    if (cents > 0) {
      parts.push(`${label} ${formatMoney(cents)}`)
    }
  }
  parts.push(`运费 ${formatMoney(quote.shipping.cents)}`)
  parts.push(`应付 ${formatMoney(quote.payableCents)}`)
  return parts.join('；')
}

function formatMoney(cents) {
  return `¥${(assertSafeCents(cents) / 100).toFixed(2)}`
}
