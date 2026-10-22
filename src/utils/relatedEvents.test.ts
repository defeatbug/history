import { describe, it, expect } from 'vitest'
import type { HistoryEvent } from '@/data/chinaHistory'
import { resolveRelatedEvents } from './relatedEvents'

/** 构造最小 HistoryEvent 字面量，只关心 id / title 与解析结果 */
const event = (id: string, title = `事件-${id}`): HistoryEvent => ({
  id,
  title,
  period: '公元前2070年',
  year: '前2070',
  dynasty: '夏朝',
  category: '政治',
  description: '描述',
  content: '详细讲解',
  significance: '历史意义',
  keywords: [],
})

const all = [event('a'), event('b'), event('c'), event('d')]

describe('resolveRelatedEvents —— 相关事件 ID 解析', () => {
  it('按 ids 顺序返回，保持后台排序', () => {
    const result = resolveRelatedEvents(['c', 'a', 'b'], all)
    expect(result.map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('静默过滤不存在的悬空 id（事件已删除）', () => {
    const result = resolveRelatedEvents(['a', 'missing', 'c'], all)
    expect(result.map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('过滤 selfId，事件不会关联自己', () => {
    const result = resolveRelatedEvents(['b', 'a', 'c'], all, 'a')
    expect(result.map((e) => e.id)).toEqual(['b', 'c'])
  })

  it('重复 id 去重，保留第一次出现的位置', () => {
    const result = resolveRelatedEvents(['b', 'a', 'b', 'a'], all)
    expect(result.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('悬空 id 重复出现也只算一次过滤，不影响其他事件', () => {
    const result = resolveRelatedEvents(['missing', 'b', 'missing'], all)
    expect(result.map((e) => e.id)).toEqual(['b'])
  })

  it('ids 为空数组、undefined 或总数据为空时返回 []', () => {
    expect(resolveRelatedEvents([], all)).toEqual([])
    expect(resolveRelatedEvents(undefined, all)).toEqual([])
    expect(resolveRelatedEvents(['a'], [])).toEqual([])
  })
})
