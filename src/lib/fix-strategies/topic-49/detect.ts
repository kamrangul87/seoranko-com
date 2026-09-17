/**
 * Topic 49 — detect <img> elements missing or wrong width/height.
 *
 * Intrinsic size comes from the image FILE HEADER only (shared helper).
 * Never invents dimensions. No CLS claims.
 */

import {
  resolveFixTarget,
  type FixTargetResult,
  parseHtml,
} from '@/lib/fix-strategies/shared'
import {
  fetchImageHeaderBytes,
  readImageIntrinsicSize,
  type IntrinsicSize,
} from '@/lib/fix-strategies/shared/image-intrinsic-size'
import {
  classifyImgDimensions,
  isSvgWithViewBox,
  parseDeclaredDims,
  parseSrcsetUrls,
  ratiosMatch,
  ratioOf,
  type ImgDimSeverity,
  type Topic49Verdict,
} from './classify'
import { inspectImgCss } from './css-signals'

export type Topic49Finding = {
  kind: 'performance/img-missing-dimensions'
  sourceUrl: string
  src: string
  verdict: Topic49Verdict
  severity: ImgDimSeverity | null
  detail: string
  declared: { width: number | null; height: number | null }
  intrinsic: IntrinsicSize | null
  proposed: { width: number; height: number } | null
  /** Selector hint: src attribute value as it appeared. */
  srcAttr: string
  fixTarget: FixTargetResult
  /** Topic 70 / caller-resolved declaration site for register-wide rollup. */
  declarationSite: string | null
}

export type DetectTopic49Result = {
  findings: Topic49Finding[]
  ok: Array<{ src: string; detail: string }>
}

export type DetectTopic49Options = {
  fetch: typeof fetch
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /**
   * Repo path or logical id of the declaring layout/component/generator
   * (topic 70). Defaults to generatorPath when fixing a generator.
   */
  declarationSite?: string | null
}

export async function detectImgMissingDimensions(
  html: string,
  pageUrl: string,
  options: DetectTopic49Options,
): Promise<DetectTopic49Result> {
  const parsed = parseHtml(html)
  const imgs = [
    ...parsed.bodyElements('img'),
    ...parsed.headElements('img'),
  ]

  const findings: Topic49Finding[] = []
  const ok: DetectTopic49Result['ok'] = []

  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/page.tsx',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })
  const declarationSite =
    options.declarationSite ??
    (fixTarget.action === 'fix-generator' ? fixTarget.targetPath : null)

  for (const img of imgs) {
    const srcAttr = img.attrs.src ?? ''
    if (!srcAttr) continue

    let absoluteSrc: string
    try {
      absoluteSrc = new URL(srcAttr, pageUrl).toString()
    } catch {
      continue
    }

    const css = inspectImgCss(html, img.attrs)
    const declared = parseDeclaredDims(img.attrs)

    const header = await fetchImageHeaderBytes(absoluteSrc, options.fetch)
    const isSvg = isSvgWithViewBox(img.attrs, header.contentType, header.bytes)

    let intrinsic: IntrinsicSize | null = null
    let unreadable = false

    if (!isSvg) {
      if (!header.bytes) {
        unreadable = true
      } else {
        intrinsic = readImageIntrinsicSize(header.bytes)
        if (intrinsic == null) unreadable = true
      }
    }

    // srcset candidate ratio comparison (P5)
    let srcsetMismatch = false
    const srcset = img.attrs.srcset
    if (srcset && !unreadable && !isSvg) {
      const urls = parseSrcsetUrls(srcset, pageUrl)
      const ratios: number[] = []
      for (const u of urls) {
        const h = await fetchImageHeaderBytes(u, options.fetch)
        if (!h.bytes) {
          unreadable = true
          break
        }
        const size = readImageIntrinsicSize(h.bytes)
        if (!size) {
          unreadable = true
          break
        }
        ratios.push(ratioOf(size.width, size.height))
      }
      if (!unreadable && ratios.length >= 2) {
        const first = ratios[0]!
        srcsetMismatch = ratios.some((r) => !ratiosMatch(r, first))
      }
    }

    const classified = classifyImgDimensions({
      declared,
      intrinsic,
      unreadable,
      hasHeightAuto: css.hasHeightAuto,
      hasAspectRatio: css.hasAspectRatio,
      srcsetMismatch,
      isSvgViewBox: isSvg,
    })

    if (
      classified.verdict === 'ok' ||
      classified.verdict === 'skip-svg-viewbox'
    ) {
      ok.push({ src: srcAttr, detail: classified.detail })
      continue
    }

    findings.push({
      kind: 'performance/img-missing-dimensions',
      sourceUrl: pageUrl,
      src: absoluteSrc,
      verdict: classified.verdict,
      severity: classified.severity,
      detail: classified.detail,
      declared,
      intrinsic,
      proposed: classified.proposed,
      srcAttr,
      fixTarget,
      declarationSite,
    })
  }

  return { findings, ok }
}
