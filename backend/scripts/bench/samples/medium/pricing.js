// 价格计算与展示辅助；数据表较大，文件会跨越分块边界。
const LEVEL_DISCOUNTS = {
  vip: 0.8,
  gold: 0.85,
  silver: 0.9,
  bronze: 0.95,
  normal: 1,
  guest: 1,
  trial: 0.98,
  staff: 0.7,
  partner: 0.75,
  internal: 0.6,
  'vip-annual': 0.78,
  'vip-monthly': 0.82,
  'gold-annual': 0.83,
  'gold-monthly': 0.87,
  'silver-annual': 0.88,
  'silver-monthly': 0.92,
  'bronze-annual': 0.93,
  'bronze-monthly': 0.96,
  'trial-extended': 0.97,
  'staff-full': 0.7,
  'staff-part': 0.8,
  'partner-gold': 0.74,
  'partner-silver': 0.78,
  'internal-full': 0.6,
  'internal-part': 0.75
}

const REGION_CODES = {
  'region-north': 'N',
  'region-south': 'S',
  'region-east': 'E',
  'region-west': 'W',
  'region-center': 'C',
  'region-northeast': 'NE',
  'region-northwest': 'NW',
  'region-southeast': 'SE',
  'region-southwest': 'SW',
  'region-overseas': 'OS',
  'region-north-coast': 'NC',
  'region-south-coast': 'SC',
  'region-east-coast': 'EC',
  'region-west-coast': 'WC',
  'region-mountain': 'MT',
  'region-valley': 'VL',
  'region-island': 'IS',
  'region-border': 'BD',
  'region-capital': 'CP',
  'region-harbor': 'HB'
}

// 按会员等级折算金额。
export function calculateTotal(user, amount) {
  const factor = LEVEL_DISCOUNTS[user.level] ?? 1
  return amount * factor
}

// 金额格式化：保留两位小数。
export function formatAmount(amount) {
  return Math.round(amount * 100) / 100
}

// 用户描述：地区编码与等级拼接。
export function describeUser(user) {
  const level = user.level ?? 'normal'
  const code = REGION_CODES[user.region] ?? '?'
  return code + '@' + level
}

// 折扣说明：按等级返回文案。
export function discountLabel(user) {
  const factor = LEVEL_DISCOUNTS[user.level] ?? 1
  if (factor === 1) {
    return '无折扣'
  }
  const percent = Math.round((1 - factor) * 100)
  return '优惠' + percent + '%'
}
