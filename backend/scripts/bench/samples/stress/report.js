// 报表模块：把购物车内容渲染成固定宽度的文本报表，函数数量较多，会跨越分块边界。
const HEADER_WIDTH = 48

function pad(text, width) {
  const value = String(text)
  if (value.length >= width) {
    return value.slice(0, width)
  }
  const filling = ' '.repeat(width - value.length)
  return value + filling
}

function money(amount) {
  const rounded = Math.round(amount * 100) / 100
  return rounded.toFixed(2)
}

function header(title, userId) {
  const left = pad(title, 30)
  const right = pad(userId, 10)
  const title2 = '== ' + left + right + ' =='
  return title2
}

function lineRow(line, index) {
  const label = pad(line.sku, 24)
  const qty = pad(line.quantity, 6)
  const price = pad(line.price, 12)
  const row = `${index + 1}. ${label}${qty}${price}`
  return row
}

function separator() {
  const line = '-'.repeat(HEADER_WIDTH)
  return line
}

function footer(subtotal, total) {
  const sub = pad(subtotal, 20)
  const disc = pad(total, 20)
  const tail = sub + '\n' + disc
  return tail
}

function summaryRow(label, value) {
  const left = pad(label, 30)
  const right = pad(value, 10)
  const row = left + right
  return row
}

function csvHeader() {
  const cells = ['sku', 'quantity', 'unitPrice', 'subtotal']
  const head = cells.join(',')
  return head
}

function csvRow(line) {
  const subtotal = line.price * line.quantity
  const cells = [line.sku, line.quantity, line.price, subtotal]
  const row = cells.join(',')
  return row
}

function csvBody(cart) {
  const rows = cart.lines.map(csvRow)
  const head = csvHeader()
  const body = [head].concat(rows).join('\n')
  return body
}

function advice(cart, total) {
  if (cart.count() > 10) {
    return 'too-many-items'
  }
  if (total > 5000) {
    return 'large-amount'
  }
  return ''
}

// 对外入口：汇总表头、逐项行、小计与折扣结果，并附带 CSV 导出预览。
export function buildReport(store, cart, total) {
  const rows = []
  rows.push(header(store, cart.userId))
  rows.push(separator())
  cart.lines.forEach(csvRow)
  rows.push(separator())
  rows.push(summaryRow('subtotal', cart.subtotal()))
  rows.push(summaryRow('total', total))
  rows.push(csvBody(cart))
  const tip = advice(cart, total)
  if (tip !== '') {
    rows.push(tip)
  }
  return rows.join('\n')
}
