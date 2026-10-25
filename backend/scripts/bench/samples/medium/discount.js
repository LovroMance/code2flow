import { calculateTotal } from './pricing.js'

// 区域附加费表：按地区编码取固定附加费。
const SURCHARGES = {
  'region-north': 5,
  'region-south': 3,
  'region-east': 4,
  'region-west': 6,
  'region-center': 2,
  'region-northeast': 7,
  'region-northwest': 6,
  'region-southeast': 4,
  'region-southwest': 5,
  'region-overseas': 12
}

// 会员折扣包装：先算原价，再按会员等级与地区附加费折算。
export function applyDiscount(user, amount) {
  const base = calculateTotal(user, amount)
  const extra = SURCHARGES[user.region] ?? 0

  if (user.level === 'vip') {
    return base * 0.9 + extra
  }

  return base + extra
}
