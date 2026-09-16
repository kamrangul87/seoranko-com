/**
 * Topic 49 postcondition verifier.
 *
 * Asserts against LIVE served HTML + fetched image headers:
 * every <img> carries width/height whose ratio matches the intrinsic header
 * ratio within tolerance. Never claims CLS. Does not import the fixer.
 */

import { parseHtml } from '@/lib/fix-strategies/shared'
import {
  fetchImageHeaderBytes,
  readImageIntrinsicSize,
} from '@/lib/fix-strategies/shared/image-intrinsic-size'
import {
  isSvgWithViewBox,
  parseDeclaredDims,
  ratioOf,
  ratiosMatch,
} from './classify'

export type LiveImgDimVerification = {
  ok: boolean
  detail: string
  failures: Array<{ src: string; reason: string }>
}

export async function verifyLiveImgDimensions(
  liveHtml: string,
  pageUrl: string,
  fetchImpl: typeof fetch,
): Promise<LiveImgDimVerification> {
  const parsed = parseHtml(liveHtml)
  const imgs = [
    ...parsed.bodyElements('img'),
    ...parsed.headElements('img'),
  ]
  const failures: LiveImgDimVerification['failures'] = []

  for (const img of imgs) {
    const srcAttr = img.attrs.src ?? ''
    if (!srcAttr) continue

    let absolute: string
    try {
      absolute = new URL(srcAttr, pageUrl).toString()
    } catch {
      failures.push({ src: srcAttr, reason: 'unparseable src' })
      continue
    }

    const header = await fetchImageHeaderBytes(absolute, fetchImpl)
    if (isSvgWithViewBox(img.attrs, header.contentType, header.bytes)) {
      continue
    }

    if (!header.bytes) {
      failures.push({
        src: srcAttr,
        reason: `cannot verify — ${header.detail}`,
      })
      continue
    }

    const intrinsic = readImageIntrinsicSize(header.bytes)
    if (!intrinsic) {
      failures.push({
        src: srcAttr,
        reason: 'intrinsic header unreadable',
      })
      continue
    }

    const declared = parseDeclaredDims(img.attrs)
    if (declared.width == null || declared.height == null) {
      failures.push({
        src: srcAttr,
        reason: 'missing width and/or height attribute',
      })
      continue
    }

    if (
      !ratiosMatch(
        ratioOf(declared.width, declared.height),
        ratioOf(intrinsic.width, intrinsic.height),
      )
    ) {
      failures.push({
        src: srcAttr,
        reason: `ratio ${declared.width}×${declared.height} ≠ intrinsic ${intrinsic.width}×${intrinsic.height}`,
      })
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      detail: `${failures.length} img(s) fail dimension postcondition`,
      failures,
    }
  }

  return {
    ok: true,
    detail:
      'all imgs have width/height matching intrinsic header ratio',
    failures: [],
  }
}
