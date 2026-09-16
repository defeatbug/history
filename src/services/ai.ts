/**
 * AI 对话服务
 * ---------------------------------------------------------------
 * 通过 Supabase Edge Function 代理调用 DeepSeek。
 *
 * 安全模型（P1-4 的核心改动）：
 *   前端**不再持有** DeepSeek API Key。密钥只存在于 Edge Function
 *   的服务端环境变量中，前端只与自己项目的函数通信。
 *
 *   原实现用 VITE_DEEPSEEK_API_KEY，而 Vite 会把 VITE_ 前缀变量
 *   打包进浏览器产物，任何人打开 devtools 即可窃取。
 *
 * 调用链：
 *   浏览器 ──(用户 JWT)──> Edge Function ──(服务端密钥)──> DeepSeek
 */

import { supabase } from '@/lib/supabase'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatCompletionOptions {
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/** AI 服务错误，带 HTTP 状态码与业务错误标识 */
export class AiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'AiError'
    this.status = status
    this.code = code
  }

  /** 是否需要登录（游客会拿到这个） */
  get needsLogin(): boolean {
    return this.status === 401
  }

  /** 是否被限流 */
  get isRateLimited(): boolean {
    return this.status === 429
  }
}

/** 拼接 Edge Function 地址 */
function getFunctionEndpoint(): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!base) {
    throw new AiError('Supabase 未配置，无法使用 AI 助手', 0, 'not_configured')
  }
  return `${base}/functions/v1/chat`
}

/**
 * 流式获取 AI 回复。
 *
 * 用法：
 *   for await (const chunk of streamChat(messages)) { ... }
 */
export async function* streamChat(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): AsyncGenerator<string, void, unknown> {
  const endpoint = getFunctionEndpoint()
  const anonKey = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? ''

  // 优先使用登录用户的会话令牌；游客没有会话则回退到 anon key，
  // 由 Edge Function 判定并返回 401，前端据此提示「请先登录」。
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const token = session?.access_token ?? anonKey
  if (!token) {
    throw new AiError('请先登录后再使用 AI 助手', 401, 'no_session')
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }),
      signal: options.signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new AiError('网络连接失败，请检查网络后重试', 0, 'network_error')
  }

  // --- 错误处理 ---
  if (!response.ok) {
    let message = `AI 请求失败（HTTP ${response.status}）`
    let code: string | undefined

    try {
      const data = (await response.json()) as { error?: string; code?: string }
      if (data?.error) message = data.error
      code = data?.code
    } catch {
      // 响应不是 JSON，保留默认文案
    }

    // 给常见状态码兜底文案
    if (response.status === 401 && message === `AI 请求失败（HTTP 401）`) {
      message = 'AI 助手需要登录后使用，请先注册或登录账号'
    }

    throw new AiError(message, response.status, code)
  }

  if (!response.body) {
    throw new AiError('无法读取响应内容', 500, 'no_body')
  }

  // --- 解析 SSE 流 ---
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      // 最后一行可能不完整，留到下一轮
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue

        const data = trimmed.slice(6)
        if (data === '[DONE]') return

        try {
          const parsed = JSON.parse(data)
          const delta = parsed?.choices?.[0]?.delta
          const content = delta?.content
          if (typeof content === 'string' && content.length > 0) {
            yield content
          }
          if (parsed?.choices?.[0]?.finish_reason === 'stop') return
        } catch {
          // 分片导致的 JSON 不完整，忽略
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** 一次性获取完整回复（非流式场景使用） */
export async function chatOnce(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<string> {
  let result = ''
  for await (const chunk of streamChat(messages, options)) {
    result += chunk
  }
  return result
}
