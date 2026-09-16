/**
 * Supabase Edge Function —— AI 对话代理
 * ============================================================================
 * 为什么需要它：
 *   原实现把 DeepSeek API Key 放在前端环境变量（VITE_DEEPSEEK_API_KEY）里，
 *   而 Vite 会把 VITE_ 前缀的变量打包进浏览器产物 —— 任何人打开 devtools
 *   都能拿到 Key 并盗刷。本函数把密钥留在服务端，前端不再接触它。
 *
 * 职责：
 *   1. 鉴权 —— 只允许已登录用户调用
 *   2. 限流 —— 基于数据库的滑动窗口计数（函数无状态，不能用内存）
 *   3. 输入清洗与上下文裁剪 —— 防止超长输入耗尽 token
 *   4. 用量记录 —— 写入 ai_usage，供限流与统计
 *   5. 流式转发 —— 把 DeepSeek 的 SSE 流原样透传给前端
 *
 * 部署：
 *   supabase secrets set DEEPSEEK_API_KEY=sk-xxxx
 *   supabase functions deploy chat
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-chat'

/** 上下文最多保留的最近消息条数 */
const MAX_MESSAGES = 10
/** 单条消息最大字符数 */
const MAX_CHARS = 4000
/** 请求体最大字节数 */
const MAX_BODY_BYTES = 64 * 1024

/** 限流：窗口（秒）与窗口内最大调用次数 */
const RATE_WINDOW_SECONDS = 60
const RATE_MAX_REQUESTS = 10

const SYSTEM_PROMPT = `你是一个专业的历史知识助手，专门帮助用户学习历史知识。你是 HistoriaQuest 应用的 AI 助手，可以回答关于中国历史、世界历史、历史课程、博物馆、文物等相关问题。请用友好、专业、易懂的方式回答用户的问题。如果用户询问的问题与历史无关，你可以友好地引导用户回到历史话题。`

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

interface IncomingMessage {
  role?: unknown
  content?: unknown
}

// ---------------------------------------------------------------------------
// 主处理
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  // --- CORS 预检 ---
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return json({ error: '仅支持 POST 请求' }, 405)
  }

  // --- 服务端密钥（先保存，鉴权通过后再校验，避免向未授权方暴露服务状态）---
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY')

  // --- 鉴权：必须带真实用户会话 ---
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[chat] 缺少 SUPABASE_URL / SUPABASE_ANON_KEY')
    return json({ error: '服务端配置错误' }, 500)
  }

  // 用调用者的 JWT 构造客户端，让 RLS 正常生效
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    // 游客（只有 anon key，没有用户会话）会走到这里
    return json({ error: 'AI 助手需要登录后使用，请先注册或登录账号' }, 401)
  }

  // 鉴权通过后才告知配置问题（避免未授权方探测服务端状态）
  if (!apiKey) {
    console.error('[chat] DEEPSEEK_API_KEY 未配置')
    return json({ error: '服务端未配置 AI 密钥，请联系管理员' }, 500)
  }

  // --- 限流 ---
  const { data: usedCount, error: countError } = await supabase.rpc('ai_usage_count', {
    p_user_id: user.id,
    p_window_seconds: RATE_WINDOW_SECONDS,
  })

  if (countError) {
    // 限流查询失败不阻断服务，只记录
    console.warn('[chat] 限流查询失败:', countError.message)
  } else if ((usedCount ?? 0) >= RATE_MAX_REQUESTS) {
    return json(
      {
        error: `请求过于频繁，请稍后再试（每 ${RATE_WINDOW_SECONDS} 秒最多 ${RATE_MAX_REQUESTS} 次）`,
        retryAfter: RATE_WINDOW_SECONDS,
      },
      429,
    )
  }

  // --- 解析请求体 ---
  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY_BYTES) {
    return json({ error: '请求内容过长' }, 413)
  }

  let payload: { messages?: IncomingMessage[] }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ error: '请求格式错误' }, 400)
  }

  const incoming = Array.isArray(payload?.messages) ? payload.messages : []
  if (incoming.length === 0) {
    return json({ error: '消息内容不能为空' }, 400)
  }

  // --- 清洗与上下文裁剪 ---
  const validRoles = new Set(['user', 'assistant', 'system'])
  const messages = incoming
    .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: typeof m.role === 'string' && validRoles.has(m.role) ? m.role : 'user',
      content: (m.content as string).slice(0, MAX_CHARS),
    }))
    .slice(-MAX_MESSAGES)

  if (messages.length === 0) {
    return json({ error: '消息内容不能为空' }, 400)
  }

  // --- 记录用量（后台执行，不阻塞流式响应）---
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0)
  const logUsage = supabase
    .from('ai_usage')
    .insert({ user_id: user.id, model: MODEL, prompt_chars: promptChars })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn('[chat] 记录用量失败:', error.message)
    })

  // EdgeRuntime.waitUntil 让后台任务在响应返回后继续执行
  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
    EdgeRuntime.waitUntil(logUsage)
  } else {
    await logUsage
  }

  // --- 转发到 DeepSeek ---
  let upstream: Response
  try {
    upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: 2000,
        stream: true,
      }),
    })
  } catch (error) {
    console.error('[chat] 请求 DeepSeek 失败:', error)
    return json({ error: '无法连接 AI 服务，请检查网络后重试' }, 502)
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    console.error('[chat] DeepSeek 返回错误', upstream.status, text.slice(0, 500))

    let message = 'AI 服务暂时不可用，请稍后重试'
    if (upstream.status === 401) message = 'AI 服务密钥无效，请联系管理员'
    else if (upstream.status === 402) message = 'AI 服务额度不足'
    else if (upstream.status === 429) message = 'AI 服务请求过于频繁，请稍后再试'
    else if (upstream.status >= 500) message = 'AI 服务端错误，请稍后重试'

    return json({ error: message }, 502)
  }

  // --- 流式透传 ---
  return new Response(upstream.body, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})
