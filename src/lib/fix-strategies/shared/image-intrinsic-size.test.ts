import { describe, expect, it } from 'vitest'
import {
  readImageIntrinsicSize,
  IMAGE_HEADER_PROBE_BYTES,
} from './image-intrinsic-size'

/** Minimal IHDR-bearing PNG header (no IDAT — header parse only). */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33)
  // signature
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  // length 13
  b[11] = 13
  // IHDR
  b.set([0x49, 0x48, 0x44, 0x52], 12)
  b[16] = (width >>> 24) & 0xff
  b[17] = (width >>> 16) & 0xff
  b[18] = (width >>> 8) & 0xff
  b[19] = width & 0xff
  b[20] = (height >>> 24) & 0xff
  b[21] = (height >>> 16) & 0xff
  b[22] = (height >>> 8) & 0xff
  b[23] = height & 0xff
  // bit depth / color / compression / filter / interlace
  b[24] = 8
  b[25] = 2
  return b
}

function gifHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(10)
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
  b[6] = width & 0xff
  b[7] = (width >> 8) & 0xff
  b[8] = height & 0xff
  b[9] = (height >> 8) & 0xff
  return b
}

describe('readImageIntrinsicSize', () => {
  it('reads PNG IHDR width/height from header bytes only', () => {
    const size = readImageIntrinsicSize(pngHeader(1920, 1080))
    expect(size).toEqual({ width: 1920, height: 1080, format: 'png' })
  })

  it('reads GIF logical screen descriptor', () => {
    expect(readImageIntrinsicSize(gifHeader(800, 600))).toEqual({
      width: 800,
      height: 600,
      format: 'gif',
    })
  })

  it('returns null for truncated / unknown bytes — never invents', () => {
    expect(readImageIntrinsicSize(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(readImageIntrinsicSize(new Uint8Array(0))).toBeNull()
  })

  it('exports a bounded probe size', () => {
    expect(IMAGE_HEADER_PROBE_BYTES).toBeGreaterThan(1024)
    expect(IMAGE_HEADER_PROBE_BYTES).toBeLessThanOrEqual(65_536)
  })
})
