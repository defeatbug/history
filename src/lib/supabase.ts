import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_KEY

/**
 * 是否已正确配置 Supabase 环境变量。
 *
 * 未配置时应用会**完全降级到本地 mock 数据**运行，所有写库操作静默跳过，
 * 因此课程、答题、勋章等功能依然可用，只是刷新后进度不保留。
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '⚠️ 未配置 VITE_SUPABASE_URL / VITE_SUPABASE_KEY，应用将以「离线模式」运行：\n' +
      '   内容读取回退到本地 mock 数据，学习进度不会持久化。\n' +
      '   配置方式：复制 .env.example 为 .env 并填写项目地址与密钥。',
  )
}

/**
 * 单个请求的超时时间（毫秒）。
 *
 * 为什么必须设：supabase-js 默认不给请求设超时，于是「网络卡住」会变成
 * 「永久等待」—— 界面停在转圈态，用户不知道是在加载还是已经失败。
 * 这在使用不稳定代理的环境下尤其明显。
 *
 * 超时后请求会以 AbortError 失败，从而走正常的错误分支，
 * 让界面显示「加载失败」而不是无限加载。
 */
const REQUEST_TIMEOUT_MS = 25_000

/**
 * 带超时的 fetch。
 *
 * 注意：调用方自带 signal 时不覆盖 —— 上层主动取消（如组件卸载）的语义
 * 比超时更重要。
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  if (init?.signal) return fetch(input, init)
  return fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

// createClient 在收到空值时会在模块加载阶段直接抛错（"supabaseUrl is required"），
// 导致整个应用白屏。这里填入占位值让客户端能正常构造——由于 isSupabaseConfigured
// 为 false，业务层不会发出任何真实请求。
const FALLBACK_URL = 'http://127.0.0.1:54321'
const FALLBACK_KEY = 'public-anon-key-placeholder'

/**
 * 带类型的 Supabase 客户端。
 * 传入 Database 泛型后，from()/rpc() 的返回值都会获得完整的类型推导。
 */
export const supabase = createClient<Database>(
  supabaseUrl || FALLBACK_URL,
  supabaseAnonKey || FALLBACK_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  },
)

/** 判断一个错误是否由请求超时引起，便于界面给出更准确的说法 */
export function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /timeout|aborted|AbortError/i.test(message)
}
