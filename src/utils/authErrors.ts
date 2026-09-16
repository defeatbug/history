/**
 * Supabase 认证错误 → 中文提示
 * ---------------------------------------------------------------
 * Supabase 返回的英文错误对用户不友好，这里统一映射。
 *
 * 错误码来源：Supabase Auth 的 error_code 字段（见官方文档
 * https://supabase.com/docs/guides/auth/debugging/error-codes）
 */

/** 需要提示用户「去邮箱验证」的错误码 */
const NEEDS_CONFIRMATION = new Set(['email_not_confirmed'])

/** 错误码 → 中文提示 */
const MESSAGES: Record<string, string> = {
  // 登录
  email_not_confirmed: '邮箱尚未验证，请先到邮箱点击验证链接',
  invalid_credentials: '邮箱或密码错误，请检查后重试',
  user_not_found: '该邮箱尚未注册',
  // 注册
  user_already_exists: '该邮箱已注册，请直接登录',
  email_exists: '该邮箱已注册，请直接登录',
  email_address_invalid: '邮箱地址无效，请检查格式',
  email_address_not_authorized: '该邮箱不在允许列表中',
  weak_password: '密码强度不足，请至少使用 6 位字符',
  signup_disabled: '当前已关闭注册功能',
  // 频率限制
  over_email_send_rate_limit: '验证邮件发送过于频繁，请稍后再试',
  over_request_rate_limit: '操作过于频繁，请稍后再试',
  over_sms_send_rate_limit: '短信发送过于频繁，请稍后再试',
  // 密码
  same_password: '新密码不能与旧密码相同',
  reauthentication_needed: '为了安全，请重新登录后再操作',
  // 会话
  session_expired: '登录已过期，请重新登录',
  session_not_found: '登录状态已失效，请重新登录',
  // 验证码 / 链接
  otp_expired: '验证链接已过期，请重新发送',
  validation_failed: '验证失败，请检查输入内容',
}

/** 按英文原文兜底匹配（部分版本不返回 error_code） */
const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/email not confirmed/i, MESSAGES.email_not_confirmed!],
  [/invalid login credentials/i, MESSAGES.invalid_credentials!],
  [/user already registered|already been registered/i, MESSAGES.user_already_exists!],
  [/rate limit/i, MESSAGES.over_email_send_rate_limit!],
  [/unable to validate email address|invalid format/i, MESSAGES.email_address_invalid!],
  [/password should be at least/i, MESSAGES.weak_password!],
  [/email link is invalid or has expired/i, MESSAGES.otp_expired!],
  [/error sending confirmation email/i, '验证邮件发送失败，请检查邮件服务配置'],
]

export interface AuthErrorInfo {
  /** 面向用户的中文提示 */
  message: string
  /** 原始错误码（若有） */
  code?: string
  /** 是否属于「需要先验证邮箱」的情况 */
  needsConfirmation: boolean
  /** 是否属于频率限制 */
  isRateLimited: boolean
}

/**
 * 把任意错误对象解析成结构化信息。
 */
export function describeAuthError(error: unknown): AuthErrorInfo {
  if (!error) {
    return { message: '未知错误，请稍后重试', needsConfirmation: false, isRateLimited: false }
  }

  // Supabase AuthError 带有 code 字段；旧版本可能只有 message
  const code =
    (error as { code?: string }).code ??
    (error as { error_code?: string }).error_code ??
    undefined

  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  let message: string | undefined

  if (code && MESSAGES[code]) {
    message = MESSAGES[code]
  }

  if (!message) {
    for (const [pattern, mapped] of MESSAGE_PATTERNS) {
      if (pattern.test(rawMessage)) {
        message = mapped
        break
      }
    }
  }

  if (!message) {
    // 未收录的错误：原样展示，避免丢失信息
    message = rawMessage || '操作失败，请稍后重试'
  }

  const isRateLimited = code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    /rate limit/i.test(rawMessage)

  return {
    message,
    code,
    needsConfirmation: Boolean(code && NEEDS_CONFIRMATION.has(code)) ||
      /email not confirmed/i.test(rawMessage),
    isRateLimited,
  }
}
