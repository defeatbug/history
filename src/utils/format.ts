/**
 * 时间与文本格式化工具
 */

/** 把日期/ISO 字符串安全地转成 Date */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 相对时间描述（面向未来的复习时间）
 *
 *   formatRelativeTime(明天)  → '1 天后'
 *   formatRelativeTime(昨天)  → '已到期 1 天'
 *   formatRelativeTime(null)  → '未安排'
 */
export function formatRelativeTime(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return '未安排'

  const diffMs = date.getTime() - Date.now()
  const abs = Math.abs(diffMs)

  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  const future = diffMs > 0

  const unit = (n: number, label: string) => (future ? `${n} ${label}后` : `已到期 ${n} ${label}`)

  if (abs < minute) return '刚刚'
  if (abs < hour) return unit(Math.round(abs / minute), '分钟')
  if (abs < day) return unit(Math.round(abs / hour), '小时')
  if (abs < month) return unit(Math.round(abs / day), '天')
  if (abs < year) return unit(Math.round(abs / month), '个月')
  return unit(Math.round(abs / year), '年')
}

/** 格式化日期：2026-01-01 */
export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** 格式化日期时间：2026-01-01 12:30 */
export function formatDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 掌握程度 → 中文标签 */
export function masteryLabel(mastery: number): { text: string; className: string } {
  if (mastery >= 1) return { text: '已掌握', className: 'bg-green-100 text-green-700' }
  if (mastery >= 0.6) return { text: '接近掌握', className: 'bg-lime-100 text-lime-700' }
  if (mastery >= 0.2) return { text: '复习中', className: 'bg-amber-100 text-amber-700' }
  return { text: '待巩固', className: 'bg-red-100 text-red-700' }
}
