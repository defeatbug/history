/**
 * 合并 SQL 打包
 * ---------------------------------------------------------------
 * 把所有迁移 + seed 合并成单个文件，用于在 Supabase Dashboard 的
 * SQL Editor 里一次性执行（绕过 5432 端口被代理阻断的问题）。
 *
 * 运行：
 *   npm run db:sql
 *
 * 产物：
 *   supabase/bundle.sql   （已加入 .gitignore）
 *
 * SQL Editor 地址：
 *   https://supabase.com/dashboard/project/<ref>/sql/new
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const migrationsDir = join(root, 'supabase/migrations')
const seedFile = join(root, 'supabase/seed.sql')
const outFile = join(root, 'supabase/bundle.sql')

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

if (files.length === 0) {
  console.error('❌ supabase/migrations 下没有找到 SQL 文件')
  process.exit(1)
}

const parts: string[] = []

parts.push(`-- ============================================================================
-- HistoriaQuest —— 合并迁移脚本（自动生成，请勿手工编辑）
--
-- 生成命令: npm run db:sql
-- 用途: 在 Supabase Dashboard 的 SQL Editor 里一次性执行
--
-- 包含:
${files.map((f) => `--   ${f}`).join('\n')}
--   seed.sql
-- ============================================================================
`)

let totalLines = 0

for (const f of files) {
  const content = readFileSync(join(migrationsDir, f), 'utf-8')
  totalLines += content.split('\n').length
  parts.push(`\n-- ===== ${f} =====\n`)
  parts.push(content)
}

if (seedFile) {
  try {
    const seed = readFileSync(seedFile, 'utf-8')
    totalLines += seed.split('\n').length
    parts.push(`\n-- ===== seed.sql =====\n`)
    parts.push(seed)
  } catch {
    console.warn('⚠️  未找到 supabase/seed.sql，已跳过')
  }
}

const bundle = parts.join('')

await Bun.write(outFile, bundle)

const lines = bundle.split('\n').length
console.log(`✅ 已生成 supabase/bundle.sql`)
console.log(`   文件数: ${files.length} 个迁移 + seed`)
console.log(`   行数  : ${lines}`)
console.log(`   大小  : ${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB`)
console.log()
console.log('在 Dashboard 里执行：')
console.log('   1. 打开 https://supabase.com/dashboard/project/_/sql/new')
console.log('   2. 粘贴 supabase/bundle.sql 的全部内容')
console.log('   3. 点击 Run')
