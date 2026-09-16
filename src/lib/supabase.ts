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
  },
)
