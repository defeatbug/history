import type { HistoryEvent } from '@/data/chinaHistory'

/**
 * 解析事件详情里的「相关事件」ID 列表。
 *
 * related_events 由后台编辑，数据可能不干净，因此这里集中做防御：
 * - 悬空引用：关联事件已被删除，静默过滤（数据库清理触发器之外的第二道防线）
 * - 自引用：当前事件不应出现在自己的相关事件里
 * - 重复 id：只保留第一次出现，避免同一事件渲染两次
 * - ids 的顺序即展示顺序（后台的排序结果）
 *
 * 纯函数，不读组件状态，便于单测。
 */
export function resolveRelatedEvents(
  ids: string[] | undefined,
  all: HistoryEvent[],
  selfId?: string,
): HistoryEvent[] {
  if (!ids || ids.length === 0 || all.length === 0) {
    return []
  }

  const eventsById = new Map(all.map((event) => [event.id, event]))
  const seen = new Set<string>()
  const result: HistoryEvent[] = []

  for (const id of ids) {
    if (id === selfId || seen.has(id)) {
      continue
    }
    seen.add(id)

    const event = eventsById.get(id)
    // 悬空引用：事件已被删除，静默跳过
    if (!event) {
      continue
    }
    result.push(event)
  }

  return result
}
