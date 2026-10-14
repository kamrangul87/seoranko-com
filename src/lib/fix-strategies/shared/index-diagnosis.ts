/**
 * Index Diagnosis — crawl evidence beside GSC "Crawled/Discovered – not indexed".
 *
 * Honest classification only:
 * - technical_cause_found: a mechanical defect we can prove from crawl/HTML
 * - no_technical_blocker: page looks crawlable/indexable; Google's quality or
 *   priority decision (never asserted as thin/duplicate/low-quality cause)
 *
 * Never promises indexing.
 */

import {
  extractHtmlCanonical,
  hasNoindexDirective,
} from '@/lib/fix-strategies/shared/response-signals'
import { countCrawlableAnchors } from '@/lib/fix-strategies/topic-73/count-crawlable-anchors'
import { extractAnchors } from '@/lib/fix-strategies/topic-1/extract-anchors'
import { isInternalHref, isSkippableHref } from '@/lib/fix-strategies/topic-1/extract-anchors'

export type IndexDiagnosisClassification =
  | 'technical_cause_found'
  | 'no_technical_blocker'

export type IndexDiagnosis = {
  pageUrl: string
  coverageState: string | null
  inboundInternalLinksRaw: number
  wordCount: number
  canonical: string | null
  robots: string | null
  lastModified: string | null
  httpStatus: number | null
  classification: IndexDiagnosisClassification
  technicalCauses: string[]
  classificationDetail: string
  neverPromiseIndexing: true
}

export type IndexDiagnosisPageInput = {
  pageUrl: string
  /** Prefer raw HTML for inbound-link and word counts Googlebot can see. */
  rawHtml: string
  headers?: Headers | null
  httpStatus?: number | null
  lastModifiedHeader?: string | null
}

function visibleWordCount(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 0
  return text.split(' ').filter(Boolean).length
}

function robotsSummary(headers: Headers | null | undefined, html: string): string | null {
  const header =
    headers?.get('x-robots-tag') || headers?.get('X-Robots-Tag') || null
  const meta = html.match(
    /<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']+)["']/i,
  )
  const metaContent = meta?.[1] ?? null
  if (!header && !metaContent) return null
  return [header && `header:${header}`, metaContent && `meta:${metaContent}`]
    .filter(Boolean)
    .join('; ')
}

/**
 * Count inbound crawlable internal links TO targetUrl from a set of raw HTML pages.
 */
export function countInboundInternalLinksRaw(
  targetUrl: string,
  pages: Array<{ pageUrl: string; rawHtml: string }>,
): number {
  let n = 0
  let targetNorm: string
  try {
    const t = new URL(targetUrl)
    t.hash = ''
    targetNorm = t.toString().replace(/\/$/, '')
  } catch {
    return 0
  }

  for (const p of pages) {
    if (!p.rawHtml) continue
    for (const a of extractAnchors(p.rawHtml)) {
      if (isSkippableHref(a.href)) continue
      if (!isInternalHref(a.href, p.pageUrl)) continue
      try {
        const resolved = new URL(a.href, p.pageUrl)
        resolved.hash = ''
        const r = resolved.toString().replace(/\/$/, '')
        if (r === targetNorm) n++
      } catch {
        /* skip */
      }
    }
  }
  return n
}

export function buildIndexDiagnosis(input: {
  pageUrl: string
  coverageState: string | null
  page: IndexDiagnosisPageInput | null
  /** All crawled pages' raw HTML for inbound link counting. */
  sitePagesRaw: Array<{ pageUrl: string; rawHtml: string }>
  /** Independent mechanical finding labels already raised on this URL. */
  independentFindings?: string[]
  /** True when robots.txt Disallow matches this URL for Googlebot. */
  disallowedByRobots?: boolean
}): IndexDiagnosis {
  const html = input.page?.rawHtml || ''
  const headers = input.page?.headers ?? null
  const canonical = html
    ? extractHtmlCanonical(html, input.pageUrl, 'text/html')
    : null
  const noindex = html
    ? hasNoindexDirective(headers ?? new Headers(), html, 'text/html')
    : false
  const inbound = countInboundInternalLinksRaw(input.pageUrl, input.sitePagesRaw)
  const words = html ? visibleWordCount(html) : 0
  const robots = html ? robotsSummary(headers, html) : null
  const lastModified =
    input.page?.lastModifiedHeader ||
    headers?.get('last-modified') ||
    headers?.get('Last-Modified') ||
    null
  const status = input.page?.httpStatus ?? null
  const outAnchors = html ? countCrawlableAnchors(html) : 0

  const technicalCauses: string[] = []
  if (status != null && status >= 400) {
    technicalCauses.push(`http_${status}`)
  }
  if (noindex) technicalCauses.push('noindex')
  if (input.disallowedByRobots) technicalCauses.push('robots_disallow')
  if (canonical) {
    try {
      const c = new URL(canonical)
      const p = new URL(input.pageUrl)
      const cNorm = c.toString().replace(/\/$/, '')
      const pNorm = p.toString().replace(/\/$/, '')
      if (c.host === p.host && cNorm !== pNorm) {
        technicalCauses.push(`canonical_elsewhere:${canonical}`)
      }
    } catch {
      /* ignore */
    }
  }
  if (inbound === 0) technicalCauses.push('zero_inbound_internal_links_raw')
  if (outAnchors === 0 && words < 50) {
    technicalCauses.push('zero_raw_crawlable_anchors')
  }
  for (const label of input.independentFindings || []) {
    // Only treat clearly mechanical topics as technical causes — never quality labels.
    if (/topic-(1|2b|3|13|14|15|19|20|26|67|73|74):/i.test(label)) {
      technicalCauses.push(`independent:${label}`)
    }
  }

  // Soft signals that are NOT alone enough to claim a technical indexing block
  // when the page is otherwise 200 + indexable + self-canonical:
  const hard = technicalCauses.filter(
    (c) =>
      !c.startsWith('zero_inbound') &&
      c !== 'zero_raw_crawlable_anchors',
  )
  // Orphan alone can be technical for Discoveredyet; for Crawled it may still
  // be priority. Treat orphan/zero-raw as technical only with another hard cause
  // OR when status/noindex/canonical issues exist. If ONLY orphan — still
  // report it as a technical discovery defect.
  const onlyDiscoverySoft =
    hard.length === 0 &&
    technicalCauses.some((c) => c.startsWith('zero_inbound') || c === 'zero_raw_crawlable_anchors')

  let classification: IndexDiagnosisClassification
  let classificationDetail: string

  if (hard.length > 0 || onlyDiscoverySoft) {
    classification = 'technical_cause_found'
    classificationDetail =
      `Technical cause found: ${technicalCauses.join('; ')}. ` +
      `Fixing these may or may not change Google's index state — never promised.`
  } else {
    classification = 'no_technical_blocker'
    classificationDetail =
      `No technical blocker found – Google's quality or priority decision. ` +
      `The crawl shows a reachable page without noindex/robots-block/canonical-elsewhere; ` +
      `this product does not translate "not indexed" into thin, duplicate, or low quality.`
  }

  return {
    pageUrl: input.pageUrl,
    coverageState: input.coverageState,
    inboundInternalLinksRaw: inbound,
    wordCount: words,
    canonical,
    robots,
    lastModified,
    httpStatus: status,
    classification,
    technicalCauses,
    classificationDetail,
    neverPromiseIndexing: true,
  }
}
