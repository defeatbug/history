/**
 * 媒体存储服务
 * ============================================================================
 * 负责把图片上传到 Supabase Storage 的 `media` bucket。
 *
 * 上传链路：
 *   选择文件 → 前端校验（类型/体积）→ canvas 压缩 → 上传 → 返回公开 URL
 *
 * bucket 与访问策略见迁移 06：
 *   * public bucket（学生无需登录即可加载课程图片）
 *   * 5 MB 上限，仅允许 image/jpeg|png|webp
 *   * 写入 / 修改 / 删除仅限管理员（is_admin()）
 *
 * 目录约定（用路径前缀区分用途，只需一套策略）：
 *   covers/courses/<uuid>.webp
 *   covers/museums/<uuid>.webp
 *   artifacts/<uuid>.webp
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { compressImage, extensionFor, formatBytes, ImageError } from '@/utils/image'

export const MEDIA_BUCKET = 'media'

export type MediaFolder = 'covers/courses' | 'covers/museums' | 'artifacts'

export interface UploadResult {
  ok: boolean
  /** 公开可访问的 URL，可直接放进 <img src> */
  url?: string
  /** bucket 内的对象路径，用于后续删除 */
  path?: string
  /** 压缩前后的体积，供界面展示 */
  originalBytes?: number
  compressedBytes?: number
  error?: string
}

/**
 * 生成不冲突的对象路径。
 * 用 UUID 而不是原文件名：避开中文名、重名、以及 `../` 之类的路径穿越。
 */
function buildPath(folder: MediaFolder, extension: string): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${folder}/${id}.${extension}`
}

/** 从公开 URL 反推出 bucket 内的对象路径 */
export function pathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`
  const index = url.indexOf(marker)
  if (index === -1) return null
  return decodeURIComponent(url.slice(index + marker.length))
}

/**
 * 压缩并上传一张图片。
 *
 * 压缩在本函数内部完成，因此调用方只需要把原始 File 交进来。
 */
export async function uploadImage(file: File, folder: MediaFolder): Promise<UploadResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Supabase 未配置，无法上传图片' }
  }

  let compressed
  try {
    compressed = await compressImage(file)
  } catch (error) {
    if (error instanceof ImageError) return { ok: false, error: error.message }
    return { ok: false, error: '图片处理失败，请重试' }
  }

  const path = buildPath(folder, extensionFor(compressed.type))

  try {
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, compressed.blob, {
      contentType: compressed.type,
      // 内容不会变（路径含 UUID），可以长缓存
      cacheControl: '31536000',
      upsert: false,
    })

    if (error) throw error

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)

    return {
      ok: true,
      url: data.publicUrl,
      path,
      originalBytes: compressed.originalBytes,
      compressedBytes: compressed.compressedBytes,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // 把常见错误翻译成可操作的中文提示
    let friendly = message
    if (/row-level security|policy/i.test(message)) {
      friendly = '没有上传权限，请确认当前账号是管理员'
    } else if (/exceeded the maximum allowed size|too large/i.test(message)) {
      friendly = `图片超过服务器 ${formatBytes(5 * 1024 * 1024)} 的上限`
    } else if (/mime type|not supported/i.test(message)) {
      friendly = '服务器不接受这种图片格式'
    }

    console.warn('[storage] 上传失败：', message)
    return { ok: false, error: friendly }
  }
}

/**
 * 删除一个已上传的对象。
 *
 * 传入公开 URL 或对象路径均可，便于调用方直接把数据库里的字段值丢进来。
 *
 * 说明：删除失败不会抛出，只返回 ok=false。
 * 调用方（如删除文物）应把它当作「尽力而为」的清理，
 * 失败时最多留下一个孤儿文件，不应阻断主流程。
 */
export async function deleteImage(urlOrPath: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Supabase 未配置' }

  const path = urlOrPath.includes('/storage/v1/')
    ? pathFromPublicUrl(urlOrPath)
    : urlOrPath

  if (!path) {
    return { ok: false, error: '无法从该地址解析出存储路径' }
  }

  try {
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path])
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[storage] 删除失败：', message)
    return { ok: false, error: message }
  }
}

/**
 * 检测某张图片是否真实可访问。
 *
 * 用于表单里的「粘贴外链」场景：管理员贴了地址但地址已失效时提醒他，
 * 而不是等学生端出现破图才发现。
 */
export async function checkImageReachable(url: string, timeoutMs = 8000): Promise<boolean> {
  if (!url) return false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    // 用 HEAD 省流量；部分图床不支持 HEAD，失败时回退 GET
    let response = await fetch(url, { method: 'HEAD', signal: controller.signal }).catch(
      () => null,
    )
    if (!response || !response.ok) {
      response = await fetch(url, { method: 'GET', signal: controller.signal }).catch(() => null)
    }
    clearTimeout(timer)
    return Boolean(response?.ok)
  } catch {
    return false
  }
}
