/**
 * Deterministic HTML before/after previews for the free Index Diagnosis tool.
 * Shows rendered HTML fragments only — never called a "code diff" (no repo access).
 */

import type { FetchedPage } from '@/lib/index-diagnosis/crawler'
import { applyPasteAndFix } from '@/lib/manual-paste-fix'
import { PUBLIC_REASON_AUTO_FIXABLE } from './explanations'
import type { PublicExclusionReason, PublicUrlEvidence } from './types'

export type PublicFixPreview = {
  reason: PublicExclusionReason
  exampleUrl: string
  headline: string
  /** Live HTML fragment (tag / head excerpt). */
  beforeHtml: string
  /** Same fragment after the mechanical fix. */
  afterHtml: string
  changeSummary: string
  autoFixable: boolean
}

const CANONICAL_LINK_RE = /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i
const META_ROBOTS_RE =
  /<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*>/i

/** Reasons we can show a concrete HTML fragment preview for. */
const PREVIEWABLE: PublicExclusionReason[] = [
  'CANONICAL_POINTS_ELSEWHERE',
  'NOINDEX_TAG',
]

function pageByUrl(
  pages: FetchedPage[],
  url: string,
): FetchedPage | undefined {
  return pages.find((p) => p.finalUrl === url || p.url === url)
}

function previewCanonical(
  url: string,
  html: string,
): PublicFixPreview | null {
  const match = html.match(CANONICAL_LINK_RE)
  if (!match) return null
  const before = match[0]
  const fixed = applyPasteAndFix({
    html,
    fixKind: 'canonical_tag',
    canonicalUrl: url,
  })
  if (!fixed.ok) return null
  const afterMatch = fixed.html.match(CANONICAL_LINK_RE)
  if (!afterMatch) return null
  return {
    reason: 'CANONICAL_POINTS_ELSEWHERE',
    exampleUrl: url,
    headline: 'Canonical points away from this URL',
    beforeHtml: before,
    afterHtml: afterMatch[0],
    changeSummary: `Point the canonical at this page’s own URL (${url}).`,
    autoFixable: PUBLIC_REASON_AUTO_FIXABLE.CANONICAL_POINTS_ELSEWHERE,
  }
}

function stripNoindexFromMeta(tag: string): string | null {
  const contentMatch = tag.match(/content\s*=\s*(["'])([^"']*)\1/i)
  if (!contentMatch) return null
  const quote = contentMatch[1]!
  const parts = contentMatch[2]!
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^noindex$/i.test(p))
  if (parts.length === contentMatch[2]!.split(',').map((p) => p.trim()).filter(Boolean).length) {
    return null // nothing removed
  }
  const next =
    parts.length > 0
      ? parts.join(', ')
      : 'index, follow'
  return tag.replace(
    /content\s*=\s*(["'])([^"']*)\1/i,
    `content=${quote}${next}${quote}`,
  )
}

function previewNoindex(url: string, html: string): PublicFixPreview | null {
  const match = html.match(META_ROBOTS_RE)
  if (!match) return null
  const before = match[0]
  if (!/noindex/i.test(before)) return null
  const after = stripNoindexFromMeta(before)
  if (!after || after === before) return null
  return {
    reason: 'NOINDEX_TAG',
    exampleUrl: url,
    headline: 'Meta robots includes noindex',
    beforeHtml: before,
    afterHtml: after,
    changeSummary:
      'Remove noindex from the robots meta tag so search engines may index the page.',
    autoFixable: PUBLIC_REASON_AUTO_FIXABLE.NOINDEX_TAG,
  }
}

function buildOne(
  row: PublicUrlEvidence,
  pages: FetchedPage[],
): PublicFixPreview | null {
  const page = pageByUrl(pages, row.url)
  if (!page?.html) return null
  if (row.reason === 'CANONICAL_POINTS_ELSEWHERE') {
    return previewCanonical(row.url, page.html)
  }
  if (row.reason === 'NOINDEX_TAG') {
    return previewNoindex(row.url, page.html)
  }
  return null
}

/**
 * Up to `max` HTML before/after previews for the free audit UI.
 * Prefers auto-fixable causes; skips reasons without live HTML evidence.
 */
export function buildPublicFixPreviews(input: {
  urls: PublicUrlEvidence[]
  fetchedPages: FetchedPage[]
  max?: number
}): PublicFixPreview[] {
  const max = input.max ?? 2
  const candidates = input.urls.filter((u) => PREVIEWABLE.includes(u.reason))
  candidates.sort((a, b) => {
    const af = PUBLIC_REASON_AUTO_FIXABLE[a.reason] ? 0 : 1
    const bf = PUBLIC_REASON_AUTO_FIXABLE[b.reason] ? 0 : 1
    if (af !== bf) return af - bf
    return 0
  })

  const out: PublicFixPreview[] = []
  const seen = new Set<string>()
  for (const row of candidates) {
    if (out.length >= max) break
    const key = `${row.reason}|${row.url}`
    if (seen.has(key)) continue
    const preview = buildOne(row, input.fetchedPages)
    if (!preview) continue
    seen.add(key)
    out.push(preview)
  }
  return out
}
