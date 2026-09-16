/**
 * 云端 Supabase 连接自检
 * ---------------------------------------------------------------
 * 运行：
 *   npm run cloud:check
 *
 * 检查内容：
 *   1. 环境变量是否配置
 *   2. 能否连通 Supabase
 *   3. 迁移是否已推送（13 张表）
 *   4. 内容种子是否已灌入
 *   5. RLS 是否生效
 *
 * 退出码：0 = 全部正常；1 = 存在问题
 *
 * 注意：本脚本对网络抖动做了重试（TUN 模式代理下首次连接常失败）。
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// 读取 .env（浏览器外运行，Vite 不参与）
// ---------------------------------------------------------------------------
function readEnvFile(name: string): string | undefined {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf-8')
    const line = text.split('\n').find((l) => l.trim().startsWith(`${name}=`))
    return line?.slice(line.indexOf('=') + 1).trim()
  } catch {
    return undefined
  }
}

const url = process.env.VITE_SUPABASE_URL ?? readEnvFile('VITE_SUPABASE_URL')
const key = process.env.VITE_SUPABASE_KEY ?? readEnvFile('VITE_SUPABASE_KEY')

// ---------------------------------------------------------------------------
// 输出helper
// ---------------------------------------------------------------------------
const ok = (m: string) => console.log(`\x1b[32m✅ ${m}\x1b[0m`)
const bad = (m: string) => console.log(`\x1b[31m❌ ${m}\x1b[0m`)
const info = (m: string) => console.log(`\x1b[36m▸ ${m}\x1b[0m`)
const warn = (m: string) => console.log(`\x1b[33m⚠️  ${m}\x1b[0m`)

let failures = 0

/** 连接层问题（代理抖动 / 证书 / 超时），而非业务错误 */
const isConnectionError = (msg: string) =>
  /certificate|socket|fetch|network|timeout|ECONNRESET|closed unexpectedly|abort/i.test(msg)

/** 网络问题的统一提示 */
function networkHint() {
  warn('你的网络经过 TUN 模式代理（DNS 解析到 198.18.x.x），首次连接常失败。')
  warn('建议：在代理软件里把 *.supabase.co 加入直连规则，或暂时关闭代理。')
}

// ---------------------------------------------------------------------------
// 1. 环境变量
// ---------------------------------------------------------------------------
console.log('── 1. 环境变量 ──')
if (!url || url.includes('<') || url.includes('your-project')) {
  bad(`VITE_SUPABASE_URL 未正确配置：${url ?? '(空)'}`)
  failures++
} else {
  ok(`URL: ${url}`)
}
if (!key || key.length < 20) {
  bad('VITE_SUPABASE_KEY 未正确配置')
  failures++
} else {
  ok(`KEY: ${key.slice(0, 12)}…（已脱敏）`)
}

if (failures > 0) {
  console.log('\n请先补全 .env 后重试。')
  process.exit(1)
}

const supabase = createClient(url!, key!)

// ---------------------------------------------------------------------------
// 2. 连通性（带重试）
// ---------------------------------------------------------------------------
console.log('\n── 2. 连通性 ──')
{
  let lastErr = ''
  let healthy = false

  for (let i = 1; i <= 4; i++) {
    try {
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: key! },
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok || res.status === 404) {
        ok(`Auth 服务可达（HTTP ${res.status}）${i > 1 ? `，第 ${i} 次尝试` : ''}`)
        healthy = true
        break
      }
      lastErr = `HTTP ${res.status}`
    } catch (e) {
      lastErr = (e as Error).message
    }
    await new Promise((r) => setTimeout(r, 500 * i))
  }

  if (!healthy) {
    bad(`无法连接：${lastErr}`)
    if (isConnectionError(lastErr)) networkHint()
    else warn('项目可能已暂停 → 到 Dashboard 点 Resume project')
    failures++
  }
}

if (failures > 0) {
  console.log('\n连通性未通过，跳过后续检查。')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3~4. 表存在性 + 行数
//
// ⚠️ 踩坑记录：用 `head: true` 探测不存在的表时，PostgREST 返回 HTTP 404
//    但 supabase-js 的 error 为 null，会被误判为“表存在”。
//    因此改用真实 GET（select + limit(1)），以 status 与 error 双重判定。
// ---------------------------------------------------------------------------

interface Probe {
  exists: boolean
  count: number | null
  error: string | null
}

async function probe(table: string): Promise<Probe> {
  let lastError: string | null = null

  for (let i = 1; i <= 3; i++) {
    const { error, status } = await supabase
      .from(table as never)
      .select('*', { count: 'exact' })
      .limit(1)

    // 表不存在：404 / PGRST205 / schema cache 提示
    const msg = error?.message ?? ''
    const missing =
      status === 404 ||
      (error as { code?: string } | null)?.code === 'PGRST205' ||
      /Could not find the table|schema cache/i.test(msg)

    if (missing) return { exists: false, count: null, error: null }
    if (!error && status >= 200 && status < 300) {
      return { exists: true, count: null, error: null }
    }

    lastError = msg || `HTTP ${status}`
    if (!isConnectionError(lastError)) break
    await new Promise((r) => setTimeout(r, 400 * i))
  }

  return { exists: false, count: null, error: lastError }
}

/** 只取行数（head 请求，但用 status 判定） */
async function countRows(table: string): Promise<number | null | 'error'> {
  for (let i = 1; i <= 3; i++) {
    const { count, error, status } = await supabase
      .from(table as never)
      .select('*', { count: 'exact', head: true })

    if (status >= 200 && status < 300) return count ?? 0

    const msg = error?.message ?? `HTTP ${status}`
    if (!isConnectionError(msg)) return 'error'
    await new Promise((r) => setTimeout(r, 400 * i))
  }
  return 'error'
}

const EXPECTED_TABLES = [
  'profiles', 'courses', 'questions', 'badges', 'history_events',
  'timeline_events', 'museums', 'artifacts', 'user_progress',
  'user_answers', 'user_badges', 'friendships', 'pk_matches',
]

console.log('\n── 3. 迁移是否已推送 ──')
const missing: string[] = []
const connErrors: string[] = []

for (const table of EXPECTED_TABLES) {
  const result = await probe(table)
  if (result.exists) continue
  if (result.error) connErrors.push(`${table}: ${result.error}`)
  else missing.push(table)
}

if (connErrors.length > 0) {
  bad(`${connErrors.length} 张表查询失败（连接问题，非表缺失）`)
  connErrors.slice(0, 2).forEach((e) => console.log(`     ${e}`))
  networkHint()
  failures++
} else if (missing.length === 0) {
  ok(`13 张表全部存在`)
} else {
  bad(`${missing.length} / ${EXPECTED_TABLES.length} 张表不存在`)
  info(`缺失：${missing.join(', ')}`)
  info('迁移尚未推送 → 执行：npm run cloud:setup')
  failures++
}

// ---------------------------------------------------------------------------
// 4. 内容种子
// ---------------------------------------------------------------------------
console.log('\n── 4. 内容种子行数 ──')
if (missing.length > 0) {
  info('跳过（迁移尚未推送）')
} else {
  const EXPECTED_COUNTS: Array<[string, number]> = [
    ['courses', 14],
    ['questions', 102],
    ['badges', 10],
    ['history_events', 15],
    ['timeline_events', 56],
    ['museums', 8],
    ['artifacts', 13],
  ]

  for (const [table, expected] of EXPECTED_COUNTS) {
    const count = await countRows(table)
    if (count === 'error') {
      bad(`${table}: 查询失败`)
      failures++
    } else if (count === expected) {
      ok(`${table}: ${count}`)
    } else {
      warn(`${table}: ${count}（期望 ${expected}）`)
    }
  }
}

// ---------------------------------------------------------------------------
// 5. RLS
// ---------------------------------------------------------------------------
console.log('\n── 5. RLS 是否生效（匿名身份）──')
if (missing.length > 0) {
  info('跳过（迁移尚未推送）')
} else {
  const { data, error, status } = await supabase.from('user_progress').select('user_id').limit(5)

  if (status >= 200 && status < 300) {
    if (!data || data.length === 0) {
      ok('匿名读 user_progress 返回 0 行 —— RLS 生效')
    } else {
      bad(`匿名身份读到了 ${data.length} 行 user_progress，RLS 可能未启用！`)
      failures++
    }
  } else if (isConnectionError(error?.message ?? '')) {
    warn(`无法验证 RLS（连接问题）：${error?.message}`)
    networkHint()
  } else if ((error as { code?: string } | null)?.code === '42501' || /permission denied/i.test(error?.message ?? '')) {
    ok('查询被拒绝（42501）—— RLS 生效')
  } else {
    warn(`查询出错，无法判定 RLS：${error?.message ?? status}`)
  }
}

// ---------------------------------------------------------------------------
console.log()
if (failures === 0) {
  console.log('\x1b[32m✅ 云端环境全就绪\x1b[0m')
  process.exit(0)
} else {
  console.log(`\x1b[31m❌ 存在 ${failures} 项问题\x1b[0m`)
  process.exit(1)
}
