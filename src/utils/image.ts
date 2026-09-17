/**
 * 图片压缩
 * ============================================================================
 * 为什么必须压缩：
 *   Supabase 免费版只有 1 GB 存储与 5 GB / 月带宽。
 *   手机随手拍的照片常有 3~5 MB，学生看 200 次就烧完月带宽。
 *   压到 1600px / webp 后通常只剩 200~400 KB，降一个数量级。
 *
 * 为什么放在前端：
 *   浏览器原生 canvas 就能做，不需要引库，也不需要服务端跑图像处理
 *   （Edge Function 跑 sharp 很别扭，且会拖长冷启动）。
 *
 * 安全边界：
 *   压缩是体验优化，不是安全措施。真正的上传限制在 Storage bucket 上
 *   （5 MB 上限 + 仅允许 jpeg/png/webp），见迁移 06。
 */

/** 允许的输入类型（与 bucket 的 allowed_mime_types 保持一致） */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * 两个上限必须分开，理由：
 *
 *   bucket 的 5 MB 限制针对的是**上传产物**，
 *   而我们是「先在浏览器里压缩，再上传」。
 *   若把源文件也卡在 5 MB，一张 5.1 MB 的手机照片会被直接拒掉，
 *   尽管它压缩后可能只有 300 KB。
 *
 * 因此：
 *   MAX_INPUT_BYTES  源文件上限（宽松，只为避免把超大文件读进内存）
 *   MAX_OUTPUT_BYTES 上传产物上限（与 bucket 的 file_size_limit 一致）
 */

/** 源文件大小上限：20 MB */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024

/** 上传产物大小上限，与 bucket 的 file_size_limit 保持一致 */
export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024

/** 压缩质量的降级阶梯：产物超限时依次尝试 */
const QUALITY_LADDER = [0.8, 0.65, 0.5, 0.35]

/** 压缩后的目标长边像素 */
export const MAX_DIMENSION = 1600

/** 压缩输出质量 */
export const OUTPUT_QUALITY = 0.8

export interface CompressOptions {
  /** 长边最大像素，默认 1600 */
  maxDimension?: number
  /** 输出质量 0~1，默认 0.8 */
  quality?: number
}

export interface CompressResult {
  /** 压缩后的图片（webp；浏览器不支持时回退 jpeg） */
  blob: Blob
  /** 实际输出类型 */
  type: string
  width: number
  height: number
  originalBytes: number
  compressedBytes: number
  /** 压缩比，0~1，越小说明压得越多 */
  ratio: number
  /** 实际使用的编码质量（可能因超限而降级） */
  quality: number
}

/** 业务错误，带可读原因，供界面直接展示 */
export class ImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageError'
  }
}

/** 人类可读的文件体积 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 按长边等比缩放，不放大。
 * 一张 800px 宽的图传进来仍然是 800px —— 放大只会变糊且变大。
 */
export function fitWithin(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxDimension) return { width, height }

  const scale = maxDimension / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** 校验文件类型与体积（在解码之前先做，避免读一张 50MB 的图进内存） */
export function validateImageFile(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    throw new ImageError(
      `不支持的格式：${file.type || '未知'}。请使用 JPG、PNG 或 WebP。`,
    )
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageError(
      `图片过大（${formatBytes(file.size)}），请先裁剪或压缩到 ${formatBytes(MAX_INPUT_BYTES)} 以内。`,
    )
  }
}

/** 用 createImageBitmap 或 <img> 解码，取到可绘制到 canvas 的位图 */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  // 优先用 createImageBitmap：不占 DOM，且能指定解码行为
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      }
    } catch {
      // 某些浏览器对 webp / 特殊色彩空间会失败，回退到 <img>
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new ImageError('无法解析这张图片，文件可能已损坏'))
      el.src = url
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/** 检测浏览器是否支持输出 webp */
async function supportsWebp(): Promise<boolean> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.8),
    )
    return blob?.type === 'image/webp'
  } catch {
    return false
  }
}

/**
 * 压缩一张图片。
 *
 * 流程：校验 → 解码 → 等比缩放 → canvas 重绘 → 编码为 webp
 *
 * @throws ImageError 当格式不支持、体积超限或图片无法解析时
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  validateImageFile(file)

  const maxDimension = options.maxDimension ?? MAX_DIMENSION
  const quality = options.quality ?? OUTPUT_QUALITY

  const { source, width, height, cleanup } = await decode(file)

  try {
    const target = fitWithin(width, height, maxDimension)

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageError('浏览器不支持 canvas，无法压缩图片')

    // 缩小图片时开启高质量插值，避免锯齿
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // PNG 的透明区域在转 webp 后仍保留；若回退到 jpeg 则会被填黑，
    // 因此先铺一层白底，保证回退路径也不会出现黑块。
    const outputType = (await supportsWebp()) ? 'image/webp' : 'image/jpeg'
    if (outputType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, target.width, target.height)
    }

    ctx.drawImage(source, 0, 0, target.width, target.height)

    // 按质量阶梯逐次尝试，直到产物落进上传上限。
    // 极端情况（超大尺寸 + 大量细节）单靠一次 0.8 仍可能超限。
    const ladder = [quality, ...QUALITY_LADDER.filter((q) => q < quality)]

    let blob: Blob | null = null
    let usedQuality = quality

    for (const q of ladder) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), outputType, q),
      )
      if (blob) {
        usedQuality = q
        if (blob.size <= MAX_OUTPUT_BYTES) break
      }
    }

    if (!blob) throw new ImageError('图片压缩失败，请重试')

    if (blob.size > MAX_OUTPUT_BYTES) {
      throw new ImageError(
        `这张图内容过于复杂，压缩后仍有 ${formatBytes(blob.size)}，` +
          `超过 ${formatBytes(MAX_OUTPUT_BYTES)} 的上限。请先裁剪后重试。`,
      )
    }

    return {
      blob,
      type: blob.type,
      width: target.width,
      height: target.height,
      originalBytes: file.size,
      compressedBytes: blob.size,
      ratio: blob.size / file.size,
      quality: usedQuality,
    }
  } finally {
    cleanup()
  }
}

/** 从输出类型推导文件扩展名 */
export function extensionFor(mimeType: string): string {
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/png') return 'png'
  return 'jpg'
}
