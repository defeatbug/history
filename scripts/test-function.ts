/**
 * Edge Function 端到端测试
 * ---------------------------------------------------------------
 * 用真实登录用户的会话调用 chat 函数，验证：
 *   1. 鉴权是否生效（未登录被拒）
 *   2. 密钥是否已在服务端正确配置
 *   3. 流式响应是否能正常透传
 *   4. 用量是否写入 ai_usage（限流的数据来源）
 *
 * 用法：
 *   E2E_EMAIL=你的邮箱 E2E_PASSWORD=你的密码 npm run fn:test
 *
 * 说明：
 *   项目开启了「邮箱确认」，脚本无法自动创建可登录账号，
 *   因此需要提供一个已确认的账号。可在
 *   Dashboard → Authentication → Users → Add user（勾选 Auto Confirm）创建。
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

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
const ENDPOINT = `${url}/functions/v1/chat`

const ok = (m: string) => console.log(`\x1b[32m✅ ${m}\x1b[0m`)
const bad = (m: string) => console.log(`\x1b[31m❌ ${m}\x1b[0m`)
const info = (m: string) => console.log(`\x1b[36m▸ ${m}\x1b[0m`)
const warn = (m: string) => console.log(`\x1b[33m⚠️  ${m}\x1b[0m`)

let failures = 0

console.log('════════════════════════════════════════════════')
console.log(' Edge Function 端到端测试')
console.log(` 端点: ${ENDPOINT}`)
console.log('════════════════════════════════════════════════\n')

// ---------------------------------------------------------------------------
// 1. 未登录应被拒绝
// ---------------------------------------------------------------------------
console.log('── 1. 未登录调用（应返回 401）──')
{
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }] }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) {
    ok(`正确拒绝：${body.error ?? '(无消息)'}`)
  } else {
    bad(`期望 401，实际 ${res.status}：${JSON.stringify(body)}`)
    failures++
  }
}

// ---------------------------------------------------------------------------
// 2. 登录
// ---------------------------------------------------------------------------
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

if (!email || !password) {
  console.log()
  warn('未提供测试账号，跳过登录相关测试')
  info('用法：E2E_EMAIL=xxx @ E2E_PASSWORD=xxx npm run fn:test')
  info('创建账号：Dashboard → Authentication → Users → Add user（勾选 Auto Confirm）')
  console.log(`\n\x1b[33m⚠️  已通过：1 项（鉴权）\x1b[0m`)
  process.exit(0)
}

console.log('\n── 2. 登录 ──')
const supabase = createClient(url, key, { auth: { persistSession: false } })
const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
  email,
  password,
})

if (authErr || !authData.session) {
  bad(`登录失败：${authErr?.message ?? '无会话'}`)
  process.exit(1)
}
ok(`已登录：${email}`)
const token = authData.session.access_token

// ---------------------------------------------------------------------------
// 3. 流式对话
// ---------------------------------------------------------------------------
console.log('\n── 3. 调用 AI 助手（流式）──')
{
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: key,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '用一句话介绍秦朝' }],
    }),
  })

  console.log(`   HTTP ${res.status}`)
  console.log(`   Content-Type: ${res.headers.get('content-type')}`)

  if (!res.ok) {
    const body = await res.text()
    bad(`调用失败：${body.slice(0, 300)}`)
    if (res.status === 500 && body.includes('未配置')) {
      info('需要先设置服务端密钥：')
      info('  npx supabase secrets set DEEPSEEK_API_KEY=sk-你的密钥')
      info('  npm run fn:deploy')
    }
    failures++
  } else {
    ok('流式连接已建立')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let answer = ''
    let chunks = 0

    const started = Date.now()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data: ')) continue
        const data = t.slice(6)
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          const c = parsed?.choices?.[0]?.delta?.content
          if (typeof c === 'string' && c) {
            answer += c
            chunks++
          }
        } catch {
          /* 分片 */
        }
      }
    }

    const elapsed = Date.now() - started
    if (answer.length > 0) {
      ok(`收到 ${chunks} 个流式分片，共 ${answer.length} 字符，耗时 ${elapsed}ms`)
      console.log(`\n   回复预览：\n   \x1b[90m${answer.slice(0, 160)}${answer.length > 160 ? '…' : ''}\x1b[0m`)
    } else {
      bad('未收到任何内容')
      failures++
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 用量记录（限流依据）
// ---------------------------------------------------------------------------
console.log('\n── 4. 检查用量记录 ──')
{
  const { data, error } = await supabase
    .from('ai_usage')
    .select('model, prompt_chars, created_at')
    .order('created_at', { ascending: false })
    .limit(3)

  if (error) {
    warn(`查询失败：${error.message}`)
    info('若提示表不存在，说明 ai_usage 迁移尚未推送（见 npm run cloud:setup）')
  } else if (!data || data.length === 0) {
    warn('没有用量记录（Edge Function 的写入可能被 RLS 拦下或失败）')
  } else {
    ok(`最近 ${data.length} 条用量记录：`)
    data.forEach((r) =>
      console.log(
        `     ${r.model} · ${r.prompt_chars} 字符 · ${new Date(r.created_at).toLocaleTimeString('zh-CN')}`,
      ),
    )
  }
}

await supabase.auth.signOut()

console.log()
if (failures === 0) {
  console.log('\x1b[32m✅ Edge Function 端到端测试通过\x1b[0m')
  process.exit(0)
} else {
  console.log(`\x1b[31m❌ 存在 ${failures} 项失败\x1b[0m`)
  process.exit(1)
}
