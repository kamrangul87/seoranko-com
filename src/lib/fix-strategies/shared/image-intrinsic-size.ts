/**
 * Read intrinsic width/height from image FILE HEADERS only.
 *
 * Never invents dimensions. Unsupported / truncated / corrupt headers → null.
 * Callers must treat null as human-review (topic 49 / P6).
 *
 * Supports: PNG (IHDR), JPEG (SOF0/SOF2), GIF, WebP (VP8 / VP8L / VP8X).
 * SVG is not handled here — callers detect SVG separately (viewBox rules).
 */

export type IntrinsicSize = {
  width: number
  height: number
  format: 'png' | 'jpeg' | 'gif' | 'webp'
}

/** Bytes typically enough for SOFn / IHDR / WebP chunk headers. */
export const IMAGE_HEADER_PROBE_BYTES = 65_536

export function readImageIntrinsicSize(
  header: ArrayBuffer | Uint8Array,
): IntrinsicSize | null {
  const bytes =
    header instanceof Uint8Array ? header : new Uint8Array(header)
  if (bytes.length < 10) return null

  if (isPng(bytes)) return readPng(bytes)
  if (isGif(bytes)) return readGif(bytes)
  if (isJpeg(bytes)) return readJpeg(bytes)
  if (isWebp(bytes)) return readWebp(bytes)
  return null
}

function isPng(b: Uint8Array): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
}

function readPng(b: Uint8Array): IntrinsicSize | null {
  // IHDR is the first chunk: 8 sig + 4 len + 4 type + 4 w + 4 h
  if (b.length < 24) return null
  if (
    b[12] !== 0x49 ||
    b[13] !== 0x48 ||
    b[14] !== 0x44 ||
    b[15] !== 0x52
  ) {
    return null
  }
  const width = readU32BE(b, 16)
  const height = readU32BE(b, 20)
  if (width < 1 || height < 1) return null
  return { width, height, format: 'png' }
}

function isGif(b: Uint8Array): boolean {
  return (
    b.length >= 10 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x39 || b[4] === 0x37) &&
    b[5] === 0x61
  )
}

function readGif(b: Uint8Array): IntrinsicSize | null {
  const width = b[6]! | (b[7]! << 8)
  const height = b[8]! | (b[9]! << 8)
  if (width < 1 || height < 1) return null
  return { width, height, format: 'gif' }
}

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8
}

function readJpeg(b: Uint8Array): IntrinsicSize | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const marker = b[i + 1]!
    // Soften / restart markers have no length
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
      continue
    }
    if (i + 3 >= b.length) return null
    const len = (b[i + 2]! << 8) | b[i + 3]!
    // SOF0 (baseline) / SOF2 (progressive)
    if (marker === 0xc0 || marker === 0xc2) {
      if (i + 8 >= b.length) return null
      const height = (b[i + 5]! << 8) | b[i + 6]!
      const width = (b[i + 7]! << 8) | b[i + 8]!
      if (width < 1 || height < 1) return null
      return { width, height, format: 'jpeg' }
    }
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

function isWebp(b: Uint8Array): boolean {
  return (
    b.length >= 16 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
}

function readWebp(b: Uint8Array): IntrinsicSize | null {
  // Chunk at offset 12: fourcc + size
  if (b.length < 30) return null
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)

  if (fourcc === 'VP8X' && b.length >= 30) {
    // canvas width/height are 24-bit little-endian minus 1
    const width = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16))
    const height = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))
    if (width < 1 || height < 1) return null
    return { width, height, format: 'webp' }
  }

  if (fourcc === 'VP8 ' && b.length >= 30) {
    // Lossy bitstream: after 10-byte frame tag, width/height at +6/+8 (14 bits)
    const start = 20 // 12 + 4 fourcc + 4 size
    if (b.length < start + 10) return null
    const width = b[start + 6]! | ((b[start + 7]! & 0x3f) << 8)
    const height = b[start + 8]! | ((b[start + 9]! & 0x3f) << 8)
    if (width < 1 || height < 1) return null
    return { width, height, format: 'webp' }
  }

  if (fourcc === 'VP8L' && b.length >= 25) {
    // Signature byte 0x2f then 14-bit w-1 / h-1
    const start = 20
    if (b[start] !== 0x2f) return null
    const bits =
      b[start + 1]! |
      (b[start + 2]! << 8) |
      (b[start + 3]! << 16) |
      (b[start + 4]! << 24)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    if (width < 1 || height < 1) return null
    return { width, height, format: 'webp' }
  }

  return null
}

function readU32BE(b: Uint8Array, offset: number): number {
  return (
    ((b[offset]! << 24) |
      (b[offset + 1]! << 16) |
      (b[offset + 2]! << 8) |
      b[offset + 3]!) >>>
    0
  )
}

/**
 * Fetch only the leading bytes of an image (Range when honoured).
 * Returns header bytes or null on network / non-2xx / empty body.
 */
export async function fetchImageHeaderBytes(
  url: string,
  fetchImpl: typeof fetch,
  maxBytes: number = IMAGE_HEADER_PROBE_BYTES,
): Promise<{
  bytes: Uint8Array | null
  status: number
  contentType: string | null
  detail: string
}> {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Range: `bytes=0-${maxBytes - 1}` },
    })
    const contentType = response.headers.get('content-type')
    if (response.status === 404 || response.status === 410) {
      return {
        bytes: null,
        status: response.status,
        contentType,
        detail: `image fetch status ${response.status}`,
      }
    }
    if (response.status !== 200 && response.status !== 206) {
      return {
        bytes: null,
        status: response.status,
        contentType,
        detail: `image fetch status ${response.status}`,
      }
    }
    const buf = new Uint8Array(await response.arrayBuffer())
    const bytes = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf
    if (bytes.length === 0) {
      return {
        bytes: null,
        status: response.status,
        contentType,
        detail: 'empty image body',
      }
    }
    return {
      bytes,
      status: response.status,
      contentType,
      detail: `read ${bytes.length} header bytes`,
    }
  } catch (err) {
    return {
      bytes: null,
      status: 0,
      contentType: null,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
