import { describe, expect, it } from 'vitest'
import { maxNumberedSuffix, nextNumberedId, museumNumber, nextArtifactId } from './idSequence'

describe('maxNumberedSuffix', () => {
  it('取符合格式的最大号', () => {
    expect(maxNumberedSuffix(['event-1', 'event-2', 'event-15'], /^event-(\d+)$/)).toBe(15)
  })

  it('忽略不符合格式的 id', () => {
    expect(maxNumberedSuffix(['event-3', 'legacy-99', 'event-abc'], /^event-(\d+)$/)).toBe(3)
  })

  it('空列表或全不匹配时为 0', () => {
    expect(maxNumberedSuffix([], /^event-(\d+)$/)).toBe(0)
    expect(maxNumberedSuffix(['other-9'], /^event-(\d+)$/)).toBe(0)
  })
})

describe('nextNumberedId', () => {
  it('最大号 +1', () => {
    expect(nextNumberedId(['lesson-1', 'lesson-14'], /^lesson-(\d+)$/, (n) => `lesson-${n}`)).toBe(
      'lesson-15',
    )
  })

  it('空列表时从 1 开始', () => {
    expect(nextNumberedId([], /^museum-(\d+)$/, (n) => `museum-${n}`)).toBe('museum-1')
  })
})

describe('museumNumber', () => {
  it('标准格式提取馆号', () => {
    expect(museumNumber('museum-2')).toBe('2')
  })

  it('非标准格式原样返回', () => {
    expect(museumNumber('故宫')).toBe('故宫')
  })
})

describe('nextArtifactId', () => {
  const existing = ['artifact-2-1', 'artifact-2-3', 'artifact-5-1']

  it('按馆隔离计数：museum-2 的下一件是 artifact-2-4', () => {
    expect(nextArtifactId('museum-2', existing)).toBe('artifact-2-4')
  })

  it('别馆的序号不干扰：museum-5 的下一件是 artifact-5-2', () => {
    expect(nextArtifactId('museum-5', existing)).toBe('artifact-5-2')
  })

  it('新馆从 1 开始', () => {
    expect(nextArtifactId('museum-8', existing)).toBe('artifact-8-1')
  })

  it('馆号在正则里是字面量：museum-2 不会匹配到 artifact-12-9', () => {
    expect(nextArtifactId('museum-2', ['artifact-12-9'])).toBe('artifact-2-1')
  })
})
