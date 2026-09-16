/**
 * Topic 49 — classify an <img> against intrinsic header dimensions.
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import type { IntrinsicSize } from '@/lib/fix-strategies/shared/image-intrinsic-size'

export type ImgDimSeverity = 'low' | 'moderate' | 'high'

export type Topic49Verdict =
  | 'auto-set-dimensions'
  | 'human-review-no-height-auto'
  | 'human-review-unreadable-dimensions'
  | 'human-review-shared-or-variable'
  | 'ok'
  | 'skip-svg-viewbox'
  | 'finding-wrong-ratio'
  | 'finding-srcset-ratio-mismatch'
  | 'finding-missing-dimensions'

export type DeclaredDims = {
  width: number | null
  height: number | null
}

export function parseDeclaredDims(attrs: Record<string, string>): DeclaredDims {
  return {
    width: parseDim(attrs.width),
    height: parseDim(attrs.height),
  }
}

function parseDim(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function ratioOf(width: number, height: number): number {
  return width / height
}

/**
 * Product decision: relative tolerance on |declaredRatio / intrinsicRatio - 1|.
 * Integer attribute rounding is unavoidable (dossier).
 */
export function ratioTolerance(): number {
  const v = FIX_STRATEGY_PRODUCT_DECISIONS.imageIntrinsicRatioComparisonTolerance
  return typeof v === 'number' ? v : 0.02
}

export function ratiosMatch(
  a: number,
  b: number,
  tolerance: number = ratioTolerance(),
): boolean {
  if (a <= 0 || b <= 0) return false
  return Math.abs(a / b - 1) <= tolerance
}

export function isSvgWithViewBox(
  attrs: Record<string, string>,
  contentType: string | null,
  headerBytes: Uint8Array | null,
): boolean {
  const src = (attrs.src ?? '').toLowerCase()
  if (src.endsWith('.svg') || src.includes('image/svg')) return true
  if (contentType && /image\/svg\+xml/i.test(contentType)) return true
  if (headerBytes) {
    const head = new TextDecoder()
      .decode(headerBytes.subarray(0, Math.min(headerBytes.length, 256)))
      .toLowerCase()
    if (head.includes('<svg') && /viewbox\s*=/.test(head)) return true
    if (head.includes('<svg')) return true
  }
  return false
}

export type ClassifyImgInput = {
  declared: DeclaredDims
  intrinsic: IntrinsicSize | null
  /** Header / fetch failed or unreadable. */
  unreadable: boolean
  hasHeightAuto: boolean
  hasAspectRatio: boolean
  /** srcset candidates disagree on ratio. */
  srcsetMismatch: boolean
  isSvgViewBox: boolean
}

export type ClassifyImgResult = {
  verdict: Topic49Verdict
  severity: ImgDimSeverity | null
  detail: string
  /** Intrinsic dims to write when auto-fixing. */
  proposed: { width: number; height: number } | null
}

export function classifyImgDimensions(
  input: ClassifyImgInput,
): ClassifyImgResult {
  if (input.isSvgViewBox) {
    return {
      verdict: 'skip-svg-viewbox',
      severity: null,
      detail: 'SVG with viewBox — do not apply pixel dimensions (guard 5)',
      proposed: null,
    }
  }

  if (input.srcsetMismatch) {
    return {
      verdict: 'finding-srcset-ratio-mismatch',
      severity: 'moderate',
      detail: 'srcset candidates have differing intrinsic ratios (P5)',
      proposed: null,
    }
  }

  if (input.unreadable || input.intrinsic == null) {
    return {
      verdict: 'human-review-unreadable-dimensions',
      severity: 'moderate',
      detail:
        'Intrinsic dimensions unreadable — never invent values (P6)',
      proposed: null,
    }
  }

  const { width: iw, height: ih } = input.intrinsic
  const intrinsicRatio = ratioOf(iw, ih)
  const { width: dw, height: dh } = input.declared

  if (dw != null && dh != null) {
    const declaredRatio = ratioOf(dw, dh)
    if (ratiosMatch(declaredRatio, intrinsicRatio)) {
      return {
        verdict: 'ok',
        severity: null,
        detail: 'width/height present and ratio matches intrinsic',
        proposed: null,
      }
    }
    // Wrong ratio — high severity (worse than absent)
    return {
      verdict: 'finding-wrong-ratio',
      severity: 'high',
      detail: `Declared ${dw}×${dh} ratio ≠ intrinsic ${iw}×${ih} (wrong is worse than absent)`,
      proposed: input.hasHeightAuto ? { width: iw, height: ih } : null,
    }
  }

  // Missing one or both
  const missingBoth = dw == null && dh == null
  const missingOne = (dw == null) !== (dh == null)

  if (!missingBoth && !missingOne) {
    return {
      verdict: 'ok',
      severity: null,
      detail: 'dimensions ok',
      proposed: null,
    }
  }

  if (!input.hasHeightAuto) {
    return {
      verdict: 'human-review-no-height-auto',
      severity: input.hasAspectRatio ? 'low' : 'moderate',
      detail:
        'Missing dimensions and no height:auto — applying attributes may change layout (P4)',
      proposed: null,
    }
  }

  return {
    verdict: 'auto-set-dimensions',
    severity: 'moderate',
    detail: missingOne
      ? 'One dimension absent — set both from image header'
      : 'Both dimensions absent — set from image header',
    proposed: { width: iw, height: ih },
  }
}

/**
 * Parse srcset and return candidate URLs (descriptor ignored for fetch list).
 */
export function parseSrcsetUrls(srcset: string, baseUrl: string): string[] {
  const out: string[] = []
  for (const part of srcset.split(',')) {
    const token = part.trim().split(/\s+/)[0]
    if (!token) continue
    try {
      out.push(new URL(token, baseUrl).toString())
    } catch {
      // skip
    }
  }
  return out
}
