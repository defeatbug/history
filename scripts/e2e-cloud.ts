/**
 * 云端端到端验证
 * ---------------------------------------------------------------
 * 用真实账号走一遍完整链路，验证的不只是「表存在」，而是
 * 「前端实际会用到的每个操作都能成功」：
 *
 *   1. 注册（同时验证 handle_new_user 触发器是否自动建档）
 *   2. 登录并拿到会话
 *   3. 写入学习进度（upsert）
 *   4. 读回进度（验证 RLS 允许本人读取）
 *   5. 记录答题（user_answers upsert）
 *   6. 调用 evaluate_badges 服务端函数
 *   7. 验证 RLS 隔离（换个账号读不到别人数据）
 *   8. 清理测试用户数据
 *
 * 运行：npm run cloud:e2e
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

function readEnvFile(name: string): string | undefined {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf-8')
    const line = text.split('\n').find((l) => l.trim().startsWith(`${name}=`))
    return line?.slice(line.indexOf('=') + 1).trim()
  } catch {
    return undefined
  }
}

const url = process.env.VITE_SUPABASE_URL ?? readEnvFile('VITE_SUPABASE_URL')!
const key = process.env.VITE_SUPABASE_KEY ?? readEnvFile('VITE_SUPABASE_KEY')!

const ok = (m: string) => console.log(`\x1b[32m✅ ${m}\x1b[0m`)
const bad = (m: string) => console.log(`\x1b[31m❌ ${m}\x1b[0m`)
const info = (m: string) => console.log(`\x1b[36m▸ ${m}\x1b[0m`)
const warn = (m: string) => console.log(`\x1b[33m⚠️  ${m}\x1b[0m`)

let failures = 0

/** 带重试（代理环境首次连接常失败） */
async function retry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = (e as Error).message ?? ''
      if (!/certificate|socket|fetch|network|timeout|ECONNRESET|closed unexpectedly/i.test(msg)) throw e
      if (i < attempts) await new Promise((r) => setTimeout(r, 600 * i))
    }
  }
  throw lastErr
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// 两种模式：
//   登录模式 —— 提供 E2E_EMAIL / E2E_PASSWORD，用已有账号（推荐）
//   注册模式 —— 不提供则自动注册测试账号（需关闭「邮箱确认」）
const useSignIn = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD)

const stamp = Date.now()
const email = process.env.E2E_EMAIL ?? `e2e-${stamp}@historiaquest.com`
const password = process.env.E2E_PASSWORD ?? `E2e-${randomUUID().slice(0, 12)}`

console.log('════════════════════════════════════════════════')
console.log(' 云端端到端验证')
console.log(` 模式    : ${useSignIn ? '登录已有账号' : '自动注册新账号'}`)
console.log(` 测试账号: ${email}`)
console.log('════════════════════════════════════════════════\n')

// ---------------------------------------------------------------------------
// 1. 认证
// ---------------------------------------------------------------------------
console.log(useSignIn ? '── 1. 登录 ──' : '── 1. 注册 ──')

const authResult = useSignIn
  ? await retry('signIn', () =>
      supabase.auth.signInWithPassword({ email, password }),
    ).then((r) => ({ data: r.data, error: r.error, created: false }))
  : await retry('signUp', () =>
      supabase.auth.signUp({
        email,
        password,
        options: { data: { username: '端到端测试用户' } },
      }),
    ).then((r) => ({ data: r.data, error: r.error, created: true }))

const authErr = authResult.error
let session = authResult.data?.session ?? null
let userId = authResult.data?.user?.id ?? ''

if (authErr) {
  bad(`${useSignIn ? '登录' : '注册'}失败：${authErr.message}`)
  if (/rate limit/i.test(authErr.message)) {
    info('触发邮箱发送频率限制 —— 等待 1 分钟或改用登录模式重跑：')
    info('  E2E_EMAIL=xxx@xxx.com E2E_PASSWORD=xxx npm run cloud:e2e')
  }
  failures++
} else {
  ok(`${useSignIn ? '登录' : '注册'}成功`)
}

if (!session && !authErr) {
  warn('未返回会话 —— 项目开启了「邮箱确认」')
  echo_confirm_help()
  console.log(`\n已在云端创建用户 ${email}，可在 Dashboard 删除`)
  process.exit(1)
}

if (!session && authErr) {
  echo_confirm_help()
  process.exit(1)
}

ok(`已获得会话，user_id = ${userId.slice(0, 8)}…`)

function echo_confirm_help() {
  info('两种解决办法：')
  info('  A. 关闭邮箱确认（开发方便）')
  info('     Dashboard → Authentication → Sign In / Providers → Email')
  info('     → 关闭 "Confirm email"')
  info('  B. 手动建一个已确认的测试用户')
  info('     Dashboard → Authentication → Users → Add user → 勾选 Auto Confirm')
  info('     然后用登录模式重跑：')
  info('       E2E_EMAIL=xxx@xxx.com E2E_PASSWORD=xxx npm run cloud:e2e')
}

// ---------------------------------------------------------------------------
// 2. 触发器：是否自动建了 profiles + user_progress
// ---------------------------------------------------------------------------
console.log('\n── 2. 注册触发器（handle_new_user）──')
{
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, username, role')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    bad(`查询 profiles 失败：${error.message}`)
    failures++
  } else if (!profile) {
    bad('触发器未创建 profiles 记录！')
    failures++
  } else {
    ok(`profiles 已自动创建：username="${profile.username}" role=${profile.role}`)
  }

  const { data: prog } = await supabase
    .from('user_progress')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (prog) ok('user_progress 已自动创建')
  else {
    bad('触发器未创建 user_progress 记录！')
    failures++
  }
}

// ---------------------------------------------------------------------------
// 3. 写入进度
// ---------------------------------------------------------------------------
console.log('\n── 3. 写入学习进度 ──')
{
  const { error } = await supabase.from('user_progress').upsert(
    {
      user_id: userId,
      completed_lessons: ['lesson-1', 'lesson-2'],
      total_study_time: 135,
      correct_rate: 0.8571,
      current_streak: 3,
      last_lesson_id: 'lesson-3',
      last_position: 2,
      last_studied_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  if (error) {
    bad(`写入失败：${error.message}`)
    failures++
  } else {
    ok('进度写入成功')
  }
}

// ---------------------------------------------------------------------------
// 4. 读回进度
// ---------------------------------------------------------------------------
console.log('\n── 4. 读回进度 ──')
{
  const { data, error } = await supabase
    .from('user_progress')
    .select('completed_lessons, total_study_time, last_lesson_id, last_position')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    bad(`读取失败：${error.message}`)
    failures++
  } else if (!data) {
    bad('读取不到刚写入的进度（RLS 策略可能有问题）')
    failures++
  } else {
    ok(`读回成功：${data.completed_lessons.length} 门课 / ${data.total_study_time} 分钟`)
    ok(`断点：${data.last_lesson_id} 第 ${data.last_position} 题`)
  }
}

// ---------------------------------------------------------------------------
// 5. 记录答题
// ---------------------------------------------------------------------------
console.log('\n── 5. 记录答题 ──')
{
  const { error } = await supabase.from('user_answers').upsert(
    {
      user_id: userId,
      question_id: 'q1-1',
      user_answer: 1,
      is_correct: true,
      answered_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,question_id' },
  )

  if (error) {
    bad(`记录失败：${error.message}`)
    failures++
  } else {
    ok('答题记录写入成功')
  }

  // 同题重复作答应覆盖而非报错
  const { error: againErr } = await supabase.from('user_answers').upsert(
    {
      user_id: userId,
      question_id: 'q1-1',
      user_answer: 0,
      is_correct: false,
      answered_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,question_id' },
  )
  if (againErr) {
    bad(`重复作答失败：${againErr.message}`)
    failures++
  } else {
    ok('同题重复作答正常覆盖')
  }
}

// ---------------------------------------------------------------------------
// 6. 服务端勋章判定
// ---------------------------------------------------------------------------
console.log('\n── 6. 服务端勋章判定（evaluate_badges）──')
{
  const { data, error } = await supabase.rpc('evaluate_badges', { p_user_id: userId })

  if (error) {
    bad(`RPC 失败：${error.message}`)
    failures++
  } else {
    ok(`返回新解锁勋章：${JSON.stringify(data)}`)
  }

  const { data: mine } = await supabase
    .from('user_badges')
    .select('badge_id')
    .eq('user_id', userId)
  ok(`user_badges 现有：${mine?.map((b) => b.badge_id).join(', ') || '(空)'}`)
}

// ---------------------------------------------------------------------------
// 7. RLS 隔离验证
// ---------------------------------------------------------------------------
console.log('\n── 7. RLS 隔离验证 ──')
{
  // 已登录用户不应看到其他用户的行
  const { data, error } = await supabase.from('user_progress').select('user_id')

  if (error) {
    bad(`查询出错：${error.message}`)
    failures++
  } else {
    const others = (data ?? []).filter((r) => r.user_id !== userId)
    if (others.length === 0) {
      ok(`只能看到自己的 1 行（共 ${data?.length ?? 0} 行）—— 行级隔离生效`)
    } else {
      bad(`看到了 ${others.length} 行其他用户的数据！RLS 有漏洞`)
      failures++
    }
  }
}

// ---------------------------------------------------------------------------
// 8. 清理
// ---------------------------------------------------------------------------
console.log('\n── 8. 清理测试数据 ──')
{
  await supabase.from('user_answers').delete().eq('user_id', userId)
  await supabase.from('user_badges').delete().eq('user_id', userId)
  const { error } = await supabase
    .from('user_progress')
    .update({ completed_lessons: [], total_study_time: 0, last_lesson_id: null, last_position: 0 })
    .eq('user_id', userId)

  if (error) warn(`清理进度失败：${error.message}`)
  else ok('测试数据已清理')

  await supabase.auth.signOut()
  if (useSignIn) {
    info('登录模式：未修改账号本身，仅重置了进度数据')
  } else {
    info(`测试账号 ${email} 仍保留在 auth.users 中，可在 Dashboard 手动删除`)
  }
}

// ---------------------------------------------------------------------------
console.log()
if (failures === 0) {
  console.log('\x1b[32m✅ 端到端验证全部通过\x1b[0m')
  process.exit(0)
} else {
  console.log(`\x1b[31m❌ 存在 ${failures} 项失败\x1b[0m`)
  process.exit(1)
}
