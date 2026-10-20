/**
 * 业务可读 id 的序号工具
 * ----------------------------------------------------------------------------
 * 内容表用「前缀-数字」形式的可读主键（lesson-1、event-1、museum-2、
 * artifact-2-1）。新建记录时按约定取现有最大号 +1，而不是用 UUID ——
 * 保持主键可读，便于在数据库里直接看懂记录归属。
 *
 * 这里是纯函数（不碰数据库），便于单测；
 * 真正的「查现有 id」仍在 src/services/admin.ts 的 generateXxxId 里。
 */

/** 从 id 列表里取符合 pattern 的最大数字序号（无匹配时为 0） */
export function maxNumberedSuffix(ids: string[], pattern: RegExp): number {
  return ids.reduce((max, id) => {
    const m = pattern.exec(id)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
}

/** 生成下一个可读 id：现有最大号 +1 */
export function nextNumberedId(
  ids: string[],
  pattern: RegExp,
  makeId: (n: number) => string,
): string {
  return makeId(maxNumberedSuffix(ids, pattern) + 1)
}

/**
 * 从博物馆 id 提取馆号（museum-2 → "2"）。
 * 非标准格式的博物馆 id 原样返回，保证生成的文物 id 仍然唯一可读。
 */
export function museumNumber(museumId: string): string {
  return /^museum-(\d+)$/.exec(museumId)?.[1] ?? museumId
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 生成下一个文物 id：artifact-<馆号>-<该馆最大序号+1>。
 *
 * 尾号按馆隔离计数：artifact-2-1、artifact-2-2 都归 museum-2，
 * 另一馆的序号不影响本馆。
 */
export function nextArtifactId(museumId: string, artifactIds: string[]): string {
  const num = museumNumber(museumId)
  const pattern = new RegExp(`^artifact-${escapeRegExp(num)}-(\\d+)$`)
  return nextNumberedId(artifactIds, pattern, (n) => `artifact-${num}-${n}`)
}
