/**
 * RAW_RENDER_MISMATCH — content/link signals present only in raw pre-hydration
 * HTML (informational bucket, never actionable).
 */

import { detectRenderNeeded } from './detect'
import type { PageRenderEvidence } from './types'

function bodyWords(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.split(' ').filter(Boolean).length
}

function internalAnchorCount(html: string, originHost: string): number {
  const hrefs = Array.from(html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)).map(
    (m) => m[1],
  )
  return hrefs.filter((h) => {
    if (h.startsWith('/') && !h.startsWith('//')) return true
    try {
      return new URL(h, `https://${originHost}`).hostname.replace(/^www\./, '') ===
        originHost.replace(/^www\./, '')
    } catch {
      return false
    }
  }).length
}

export type RawRenderMismatchFinding = {
  code: 'RAW_RENDER_MISMATCH'
  bucket: 'informational'
  verdict: 'raw-render-mismatch'
  detail: string
  pageUrl: string
  evidence: {
    rawWords: number
    renderedWords: number
    rawInternalLinks: number
    renderedInternalLinks: number
    rawHtmlHash: string
    renderedHtmlHash: string | null
    renderMode: string
  }
}

/**
 * When rendered HTML is available and raw looked like a shell, surface an
 * informational mismatch instead of actionable thin-content / orphan-link findings.
 */
export function buildRawRenderMismatch(input: {
  pageUrl: string
  evidence: PageRenderEvidence
  originHost: string
}): RawRenderMismatchFinding | null {
  const { evidence } = input
  if (evidence.renderMode !== 'rendered' || !evidence.renderedHtml) return null
  if (!detectRenderNeeded(evidence.rawHtml).needed) return null

  const rawWords = bodyWords(evidence.rawHtml)
  const renderedWords = bodyWords(evidence.renderedHtml)
  const rawLinks = internalAnchorCount(evidence.rawHtml, input.originHost)
  const renderedLinks = internalAnchorCount(evidence.renderedHtml, input.originHost)

  const thinOnlyInRaw = rawWords < 50 && renderedWords >= 100
  const orphansOnlyInRaw = rawLinks === 0 && renderedLinks > 0
  if (!thinOnlyInRaw && !orphansOnlyInRaw) return null

  const parts: string[] = []
  if (thinOnlyInRaw) {
    parts.push(`raw body ${rawWords} words vs rendered ${renderedWords} words`)
  }
  if (orphansOnlyInRaw) {
    parts.push(`raw internal links ${rawLinks} vs rendered ${renderedLinks}`)
  }

  return {
    code: 'RAW_RENDER_MISMATCH',
    bucket: 'informational',
    verdict: 'raw-render-mismatch',
    detail: `Pre-hydration artefact: ${parts.join('; ')}. Judged from rendered DOM — not an actionable fix.`,
    pageUrl: input.pageUrl,
    evidence: {
      rawWords,
      renderedWords,
      rawInternalLinks: rawLinks,
      renderedInternalLinks: renderedLinks,
      rawHtmlHash: evidence.rawHtmlHash,
      renderedHtmlHash: evidence.renderedHtmlHash,
      renderMode: evidence.renderMode,
    },
  }
}
