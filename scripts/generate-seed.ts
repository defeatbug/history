/**
 * Seed 生成器
 * ---------------------------------------------------------------
 * 将 src/data/ 下的 TS mock 数据转换为 Supabase SQL seed。
 *
 * 运行：
 *   bun run scripts/generate-seed.ts
 *
 * 产物：
 *   supabase/migrations/20250101000003_seed_content.sql
 *
 * 设计说明：
 *   内容类数据走 migration 而非 seed.sql，这样 `supabase db push`
 *   也会把课程/题目等参考资料同步到云端，保证环境一致。
 */

import { mockLessons, mockBadges, chinaTimeline, worldTimeline } from '../src/data/mockData'
import { chinaHistoryEvents } from '../src/data/chinaHistory'
import { museums } from '../src/data/museumData'

// ---------------------------------------------------------------------------
// SQL 字面量转义
// ---------------------------------------------------------------------------
type SqlValue = string | number | boolean | null | undefined | object

const RAW = Symbol('raw')
type RawSql = { [RAW]: true; sql: string }

/** 标记为不转义的原始 SQL 片段 */
function raw(sql: string): RawSql {
  return { [RAW]: true, sql }
}

function isRaw(value: unknown): value is RawSql {
  return typeof value === 'object' && value !== null && RAW in value
}

function lit(value: SqlValue | RawSql): string {
  if (isRaw(value)) return value.sql
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return `${lit(JSON.stringify(value))}::jsonb`
  return `'${String(value).replace(/'/g, "''")}'`
}

/** text[] 数组字面量（原始 SQL，不可再被 lit 转义） */
function arr(values: string[] | undefined): RawSql {
  if (!values || values.length === 0) return raw(`'{}'::text[]`)
  return raw(`array[${values.map((v) => lit(v)).join(', ')}]::text[]`)
}

/**
 * 生成幂等 upsert 语句。
 * 使用 on conflict do update，而非 truncate cascade —— 后者会连带清空
 * 引用内容表的 user_progress / user_answers 等用户数据表。
 */
function insert(table: string, columns: string[], rows: SqlValue[][]): string {
  if (rows.length === 0) return `-- ${table}: 无数据\n`
  const values = rows
    .map((row) => `  (${row.map(lit).join(', ')})`)
    .join(',\n')
  const updates = columns
    .slice(1)
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')
  return [
    `-- ${table} (${rows.length} 行)`,
    `insert into public.${table} (${columns.join(', ')}) values`,
    values,
    `on conflict (${columns[0]}) do update set ${updates};`,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 头部
// ---------------------------------------------------------------------------
const header = `-- ============================================================================
-- HistoriaQuest — 内容种子数据（自动生成，请勿手工编辑）
--
-- 生成命令: bun run scripts/generate-seed.ts
-- 数据来源: src/data/mockData.ts / src/data/chinaHistory.ts / src/data/museumData.ts
-- ============================================================================

-- 清空说明：内容表使用 on conflict do update 幂等刷新，
-- 不使用 truncate cascade（会连带清空引用它们的用户进度表）。

`

// ---------------------------------------------------------------------------
// 1. courses / questions
// ---------------------------------------------------------------------------
const courseRows: SqlValue[][] = []
const questionRows: SqlValue[][] = []

mockLessons.forEach((lesson, index) => {
  courseRows.push([
    lesson.id,
    lesson.title,
    lesson.description ?? null,
    lesson.period ?? null,
    lesson.civilization ?? null,
    lesson.difficulty,
    lesson.estimatedTime ?? 0,
    lesson.coverImage ?? null,
    index,
  ])

  lesson.questions.forEach((q, qi) => {
    questionRows.push([
      q.id,
      lesson.id,
      q.content,
      q.type,
      q.options ?? [],
      // answer 列为 jsonb，必须显式序列化（裸数字无法隐式转为 jsonb）
      raw(`${lit(JSON.stringify(q.answer ?? null))}::jsonb`),
      q.explanation ?? null,
      qi,
    ])
  })
})

// ---------------------------------------------------------------------------
// 2. badges
// ---------------------------------------------------------------------------
const badgeRows: SqlValue[][] = mockBadges.map((b, i) => [
  b.id,
  b.name,
  b.description ?? null,
  b.icon ?? null,
  b.requirement ?? null,
  i,
])

// ---------------------------------------------------------------------------
// 3. history_events
// ---------------------------------------------------------------------------
const eventRows: SqlValue[][] = chinaHistoryEvents.map((e) => [
  e.id,
  e.title,
  e.period ?? null,
  e.year ?? null,
  e.dynasty ?? null,
  e.category ?? null,
  e.description ?? null,
  e.content ?? null,
  e.significance ?? null,
  arr(e.keywords),
  e.image ?? null,
  arr(e.relatedEvents),
])

// ---------------------------------------------------------------------------
// 4. timeline_events
// ---------------------------------------------------------------------------
const timelineRows: SqlValue[][] = [
  ...chinaTimeline.map((t, i) => [
    t.id,
    'china',
    t.year ?? null,
    t.title,
    t.description ?? null,
    t.civilization ?? null,
    t.lessonId ?? null,
    i,
  ]),
  ...worldTimeline.map((t, i) => [
    t.id,
    'world',
    t.year ?? null,
    t.title,
    t.description ?? null,
    t.civilization ?? null,
    t.lessonId ?? null,
    i,
  ]),
]

// ---------------------------------------------------------------------------
// 5. museums / artifacts
// ---------------------------------------------------------------------------
const museumRows: SqlValue[][] = []
const artifactRows: SqlValue[][] = []

museums.forEach((m) => {
  museumRows.push([
    m.id,
    m.name,
    m.nameEn ?? null,
    m.location ?? null,
    m.country ?? null,
    m.established ?? null,
    m.description ?? null,
    m.coverImage ?? null,
  ])

  m.artifacts.forEach((a) => {
    artifactRows.push([
      a.id,
      m.id,
      a.name,
      a.nameEn ?? null,
      a.period ?? null,
      a.civilization ?? null,
      a.material ?? null,
      a.dimensions ?? null,
      a.description ?? null,
      a.detailedDescription ?? null,
      a.imageUrl ?? null,
      a.significance ?? null,
    ])
  })
})

// ---------------------------------------------------------------------------
// 组装输出
// ---------------------------------------------------------------------------
const body = [
  insert('courses', ['id', 'title', 'description', 'period', 'civilization', 'difficulty', 'estimated_time', 'cover_image', 'sort_order'], courseRows),
  insert('questions', ['id', 'course_id', 'content', 'type', 'options', 'answer', 'explanation', 'sort_order'], questionRows),
  insert('badges', ['id', 'name', 'description', 'icon', 'requirement', 'sort_order'], badgeRows),
  insert('history_events', ['id', 'title', 'period', 'year', 'dynasty', 'category', 'description', 'content', 'significance', 'keywords', 'image', 'related_events'], eventRows),
  insert('timeline_events', ['id', 'track', 'year', 'title', 'description', 'civilization', 'lesson_id', 'sort_order'], timelineRows),
  insert('museums', ['id', 'name', 'name_en', 'location', 'country', 'established', 'description', 'cover_image'], museumRows),
  insert('artifacts', ['id', 'museum_id', 'name', 'name_en', 'period', 'civilization', 'material', 'dimensions', 'description', 'detailed_description', 'image_url', 'significance'], artifactRows),
].join('\n')

const out = header + body

const outPath = new URL('../supabase/migrations/20250101000003_seed_content.sql', import.meta.url)
await Bun.write(outPath, out)

console.log('✅ seed 已生成:', outPath.pathname.replace(process.cwd(), '.'))
console.log(
  `   courses=${courseRows.length} questions=${questionRows.length} badges=${badgeRows.length} ` +
    `events=${eventRows.length} timeline=${timelineRows.length} ` +
    `museums=${museumRows.length} artifacts=${artifactRows.length}`,
)
