/**
 * Topic 73 — Raw HTML has zero crawlable <a href> on homepage / high-impression pages.
 * Googlebot sees the pre-JS document; if that has no links, internal discovery stalls.
 */

import {
  countCrawlableAnchors,
  isHomepageUrl,
} from './count-crawlable-anchors'

export type Topic73Verdict = 'zero-raw-crawlable-anchors'

export type Topic73Finding = {
  verdict: Topic73Verdict
  pageUrl: string
  detail: string
  severity: 'high'
  autoFixable: false
  evidenceValues: Record<string, unknown>
}

export type DetectTopic73Result = {
  findings: Topic73Finding[]
  suppressed: Array<{ pageUrl: string; reason: string }>
  ok: Array<{ pageUrl: string; verdict: string }>
}

export type DetectTopic73Page = {
  pageUrl: string
  rawHtml: string
  /** Rendered HTML when headless ran; null if not rendered. */
  renderedHtml: string | null
}

export type DetectTopic73Options = {
  origin: string
  pages: DetectTopic73Page[]
  /** Normalized URLs above the product impressions floor (optional). */
  highImpressionNormalized?: Set<string>
  normalizeUrl?: (url: string) => string
}

function defaultNorm(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    let path = u.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    u.pathname = path || '/'
    return u.toString()
  } catch {
    return url
  }
}

export function detectZeroRawCrawlableAnchors(
  opts: DetectTopic73Options,
): DetectTopic73Result {
  const findings: Topic73Finding[] = []
  const suppressed: Array<{ pageUrl: string; reason: string }> = []
  const ok: Array<{ pageUrl: string; verdict: string }> = []
  const norm = opts.normalizeUrl ?? defaultNorm

  for (const p of opts.pages) {
    const homepage = isHomepageUrl(p.pageUrl, opts.origin)
    const n = norm(p.pageUrl)
    const highImp = opts.highImpressionNormalized?.has(n) === true
    if (!homepage && !highImp) {
      suppressed.push({ pageUrl: p.pageUrl, reason: 'not_homepage_or_high_impression' })
      continue
    }

    const rawCount = countCrawlableAnchors(p.rawHtml || '')
    const renderedCount = countCrawlableAnchors(p.renderedHtml || '')
    if (rawCount > 0) {
      ok.push({ pageUrl: p.pageUrl, verdict: 'raw_has_crawlable_anchors' })
      continue
    }

    findings.push({
      verdict: 'zero-raw-crawlable-anchors',
      pageUrl: p.pageUrl,
      severity: 'high',
      autoFixable: false,
      detail:
        `Google sees no crawlable <a href> links from this page before JavaScript runs ` +
        `(raw anchor count ${rawCount}; rendered count ${renderedCount}). ` +
        (homepage
          ? 'This is the homepage — Googlebot cannot discover internal URLs from the initial HTML. '
          : 'This page is above the Search impressions floor and still ships zero pre-JS links. ') +
        `Add real <a href> links in the server-rendered HTML. This does not promise indexing.`,
      evidenceValues: {
        rawCrawlableAnchorCount: rawCount,
        renderedCrawlableAnchorCount: renderedCount,
        isHomepage: homepage,
        highImpression: highImp,
        neverPromiseIndexing: true,
      },
    })
  }

  return { findings, suppressed, ok }
}
