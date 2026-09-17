import { describe, it, expect } from 'vitest'
import {
  fitWithin,
  formatBytes,
  validateImageFile,
  extensionFor,
  ImageError,
  ALLOWED_IMAGE_TYPES,
  MAX_INPUT_BYTES,
} from './image'

/** 构造一个假的 File，只关心 type 与 size */
function fakeFile(type: string, size: number): File {
  return { type, size } as File
}

describe('fitWithin —— 等比缩放', () => {
  it('长边超过上限时按比例缩小', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 })
  })

  it('竖图同样按长边缩放', () => {
    expect(fitWithin(1200, 2400, 1600)).toEqual({ width: 800, height: 1600 })
  })

  it('正方形正确缩放', () => {
    expect(fitWithin(4000, 4000, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('小于上限时保持原尺寸（不放大）', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('恰好等于上限时不改动', () => {
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('极端细长图不会缩到 0 像素', () => {
    const r = fitWithin(10000, 3, 1600)
    expect(r.width).toBe(1600)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })

  it('保持宽高比（误差在取整范围内）', () => {
    const src = { w: 4032, h: 3024 }
    const r = fitWithin(src.w, src.h, 1600)
    const before = src.w / src.h
    const after = r.width / r.height
    expect(Math.abs(before - after)).toBeLessThan(0.01)
  })
})

describe('formatBytes —— 体积可读化', () => {
  it('小于 1KB 用字节', () => expect(formatBytes(512)).toBe('512 B'))
  it('KB 级', () => expect(formatBytes(2048)).toBe('2 KB'))
  it('MB 级保留一位小数', () => expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB'))
  it('边界：刚好 1KB', () => expect(formatBytes(1024)).toBe('1 KB'))
})

describe('validateImageFile —— 上传前校验', () => {
  it.each(ALLOWED_IMAGE_TYPES)('接受 %s', (type) => {
    expect(() => validateImageFile(fakeFile(type, 1024))).not.toThrow()
  })

  it('拒绝 svg（可内嵌脚本，XSS 风险）', () => {
    expect(() => validateImageFile(fakeFile('image/svg+xml', 1024))).toThrow(ImageError)
  })

  it('拒绝 gif', () => {
    expect(() => validateImageFile(fakeFile('image/gif', 1024))).toThrow(ImageError)
  })

  it('拒绝空类型', () => {
    expect(() => validateImageFile(fakeFile('', 1024))).toThrow(ImageError)
  })

  it('拒绝超过源文件上限的文件', () => {
    expect(() => validateImageFile(fakeFile('image/jpeg', MAX_INPUT_BYTES + 1))).toThrow(/过大/)
  })

  it('恰好等于源文件上限时允许通过', () => {
    expect(() => validateImageFile(fakeFile('image/jpeg', MAX_INPUT_BYTES))).not.toThrow()
  })

  it('5MB 的源文件应当允许 —— 压缩会把它降到上限内', () => {
    // 这是关键回归用例：bucket 的 5MB 限制针对上传产物，
    // 不能拿来卡源文件，否则手机照片会被无谓地拒绝。
    expect(() => validateImageFile(fakeFile('image/jpeg', 5 * 1024 * 1024 + 1024))).not.toThrow()
  })

  it('错误信息包含实际体积，便于用户判断', () => {
    expect(() => validateImageFile(fakeFile('image/png', 25 * 1024 * 1024))).toThrow(/25\.0 MB/)
  })
})

describe('extensionFor —— MIME 转扩展名', () => {
  it('webp', () => expect(extensionFor('image/webp')).toBe('webp'))
  it('png', () => expect(extensionFor('image/png')).toBe('png'))
  it('jpeg', () => expect(extensionFor('image/jpeg')).toBe('jpg'))
  it('未知类型回退 jpg', () => expect(extensionFor('image/avif')).toBe('jpg'))
})
