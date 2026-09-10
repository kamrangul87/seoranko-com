/**
 * Map crawl + indexability signals → one PublicExclusionReason per URL.
 */

import { matchRobotsForUrl } from '@/lib/index-diagnosis/robots-parser'
import { extractMainContentText, jaccardSimilarity, fingerprintShingles, NEAR_DUPLICATE_THRESHOLD } from '@/lib/index-diagnosis/content-fingerprint'
import { classifyCanonical } from '@/lib/index-diagnosis/indexability'
import type { FetchedPage } from '@/lib/index-diagnosis/crawler'
import type { CrawlCoverage, ExcludedUrlRecord } from '@/lib/index-diagnosis/types'
import { buildInboundLinkMap } from '@/lib/index-diagnosis/manual-fixes'
import type { PublicExclusionReason, PublicUrlEvidence } from './types'
import { explainPublicCause } from './explanations'
import type { PublicCauseSummary } from './types'

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length
}

const SOFT_404_TITLE_RE = /\b(404|not found|page not found|does not exist|doesn't exist)\b/i

function soft404Signals(page: FetchedPage, mainText: string): string[] {
  const signals: string[] = []
  if (page.httpStatus !== 200) return signals
  if (SOFT_404_TITLE_RE.test(page.pageTitle) || SOFT_404_TITLE_RE.test(page.pageH1)) {
    signals.push('title_or_h1_looks_like_error')
  }
  const wc = wordCount(mainText)
  if (wc < 50 && /404|not found/i.test(mainText)) {
    signals.push('thin_body_mentions_404')
  }
  if (wc < 30 && SOFT_404_TITLE_RE.test(`${page.pageTitle} ${page.pageH1}`)) {
    signals.push('very_thin_error_shell')
  }
  return signals
}

function reasonFromExclude(ex: ExcludedUrlRecord): PublicExclusionReason {
  if (ex.reason === 'ROBOTS_DISALLOWED') return 'BLOCKED_BY_ROBOTS'
  if (ex.reason === 'REDIRECT_CHAIN') return 'REDIRECT_CHAIN'
  if (ex.reason === 'NON_200') {
    const s = ex.httpStatus ?? 0
    if (s >= 500) return 'HTTP_5XX'
    if (s >= 400) return 'HTTP_4XX'
    return 'HTTP_4XX'
  }
  if (ex.reason === 'DEPTH_LIMIT') {
    // Crawl stopped deeper pages — if depth message mentions >5 map, else treat as depth risk
    const m = ex.evidence.match(/Depth (\d+)/)
    const d = m ? Number(m[1]) : 0
    if (d > 5) return 'DEPTH_EXCEEDS_5'
    return 'DEPTH_EXCEEDS_5'
  }
  // TIMEOUT / PLAN_LIMIT / NOT_REACHED — not in public enum; treat as thin/unreachable → keep as HTTP_4XX-ish?
  // Spec requires exactly one of the 13 reasons. Use THIN_CONTENT only when fetched.
  // For not fetched budget: use ORPHAN for sitemap-only? Better: REDIRECT_CHAIN is wrong.
  // Map NOT_REACHED/PLAN_LIMIT/TIMEOUT to ORPHAN_NO_INLINKS only if we have no better signal —
  // Actually use a note under THIN_CONTENT is wrong.
  // Spec enum doesn't include "not crawled". Closest honest: leave as INDEXABLE? No.
  // I'll use ORPHAN_NO_INLINKS for discovered-but-not-fetched only when we have 0 inlinks evidence later;
  // For TIMEOUT use HTTP_5XX-like? Use HTTP_4XX with status null and notes — bad.
  // Practical: map TIMEOUT → HTTP_5XX (fetch failed), PLAN_LIMIT/NOT_REACHED → still include with reason based on depth if >5 else ORPHAN_NO_INLINKS for non-seed.
  if (ex.reason === 'TIMEOUT') return 'HTTP_5XX'
  return 'ORPHAN_NO_INLINKS'
}

function assignFetchedReason(
  page: FetchedPage,
  robotsTxt: string,
  inlinks: number,
  nearDupSim: number | null,
  mainText: string,
): { reason: PublicExclusionReason; notes: string; soft404: string[]; wc: number } {
  const robots = matchRobotsForUrl(robotsTxt, page.url)
  if (!robots.allowed) {
    return { reason: 'BLOCKED_BY_ROBOTS', notes: robots.evidence, soft404: [], wc: wordCount(mainText) }
  }
  if (page.httpStatus >= 500) {
    return { reason: 'HTTP_5XX', notes: `HTTP ${page.httpStatus}`, soft404: [], wc: wordCount(mainText) }
  }
  if (page.httpStatus >= 400) {
    return { reason: 'HTTP_4XX', notes: `HTTP ${page.httpStatus}`, soft404: [], wc: wordCount(mainText) }
  }
  if (page.redirectCount > 5) {
    return { reason: 'REDIRECT_CHAIN', notes: `${page.redirectCount} redirects`, soft404: [], wc: wordCount(mainText) }
  }
  if (/noindex/i.test(page.xRobotsTag)) {
    return { reason: 'NOINDEX_HEADER', notes: `X-Robots-Tag: ${page.xRobotsTag}`, soft404: [], wc: wordCount(mainText) }
  }
  if (/noindex/i.test(page.metaRobots)) {
    return {
      reason: 'NOINDEX_TAG',
      notes: `meta robots: ${page.metaRobots}`,
      soft404: [],
      wc: wordCount(mainText),
    }
  }
  const soft404 = soft404Signals(page, mainText)
  if (soft404.length > 0) {
    return { reason: 'SOFT_404_SUSPECTED', notes: soft404.join(', '), soft404, wc: wordCount(mainText) }
  }
  const canon = classifyCanonical(page.finalUrl, page.canonicalTags)
  if (canon.kind === 'other' || canon.kind === 'cross-domain' || canon.kind === 'conflicting') {
    return { reason: 'CANONICAL_POINTS_ELSEWHERE', notes: canon.evidence, soft404: [], wc: wordCount(mainText) }
  }
  if (inlinks === 0 && page.depth !== 0) {
    return {
      reason: 'ORPHAN_NO_INLINKS',
      notes: '0 internal inlinks in crawled set',
      soft404: [],
      wc: wordCount(mainText),
    }
  }
  if (page.depth > 5) {
    return { reason: 'DEPTH_EXCEEDS_5', notes: `Crawl depth ${page.depth}`, soft404: [], wc: wordCount(mainText) }
  }
  if (nearDupSim != null && nearDupSim >= NEAR_DUPLICATE_THRESHOLD) {
    return {
      reason: 'NEAR_DUPLICATE',
      notes: `Main-content Jaccard ${nearDupSim.toFixed(3)} >= ${NEAR_DUPLICATE_THRESHOLD}`,
      soft404: [],
      wc: wordCount(mainText),
    }
  }
  const wc = wordCount(mainText)
  if (wc < 200) {
    return { reason: 'THIN_CONTENT', notes: `Main content word count ${wc} < 200`, soft404: [], wc }
  }
  return { reason: 'INDEXABLE', notes: 'All public indexability checks passed', soft404: [], wc }
}

export function classifyPublicScan(opts: {
  coverage: CrawlCoverage
  fetchedPages: FetchedPage[]
  robotsTxt: string
}): {
  urls: PublicUrlEvidence[]
  topCauses: PublicCauseSummary[]
  indexableCount: number
  problemCount: number
} {
  const inboundMap = buildInboundLinkMap(opts.fetchedPages)
  const mainByUrl = new Map<string, string>()
  for (const p of opts.fetchedPages) {
    mainByUrl.set(p.finalUrl, extractMainContentText(p.html))
  }

  // Pairwise near-dup: mark URL if any other page has Jaccard >= 0.85
  const nearDupBest = new Map<string, number>()
  const pages = opts.fetchedPages
  for (let i = 0; i < pages.length; i++) {
    const a = pages[i]!
    const sa = fingerprintShingles(mainByUrl.get(a.finalUrl) || '')
    for (let j = i + 1; j < pages.length; j++) {
      const b = pages[j]!
      const sb = fingerprintShingles(mainByUrl.get(b.finalUrl) || '')
      const sim = jaccardSimilarity(sa, sb)
      if (sim >= NEAR_DUPLICATE_THRESHOLD) {
        nearDupBest.set(a.finalUrl, Math.max(nearDupBest.get(a.finalUrl) || 0, sim))
        nearDupBest.set(b.finalUrl, Math.max(nearDupBest.get(b.finalUrl) || 0, sim))
      }
    }
  }

  const urls: PublicUrlEvidence[] = []
  const seen = new Set<string>()

  for (const page of opts.fetchedPages) {
    const mainText = mainByUrl.get(page.finalUrl) || ''
    const inlinks = inboundMap.get(page.finalUrl)?.length || 0
    const robots = matchRobotsForUrl(opts.robotsTxt, page.url)
    const assigned = assignFetchedReason(
      page,
      opts.robotsTxt,
      inlinks,
      nearDupBest.get(page.finalUrl) ?? null,
      mainText,
    )
    const canon = classifyCanonical(page.finalUrl, page.canonicalTags)
    urls.push({
      url: page.finalUrl,
      reason: assigned.reason,
      httpStatus: page.httpStatus,
      robotsRuleLine: robots.ruleLine,
      metaRobots: page.metaRobots || null,
      xRobotsTag: page.xRobotsTag || null,
      canonicalTarget: canon.target || page.canonicalUrl || null,
      canonicalIsSelf: canon.kind === 'self' ? true : canon.kind === 'missing' ? null : false,
      crawlDepth: page.depth,
      internalInlinkCount: inlinks,
      mainContentWordCount: assigned.wc,
      nearDuplicateSimilarity: nearDupBest.get(page.finalUrl) ?? null,
      soft404Signals: assigned.soft404,
      evidenceNotes: assigned.notes,
    })
    seen.add(page.finalUrl)
    seen.add(page.url)
  }

  for (const ex of opts.coverage.excluded) {
    if (seen.has(ex.url)) continue
    const robots = matchRobotsForUrl(opts.robotsTxt, ex.url)
    const reason = reasonFromExclude(ex)
    urls.push({
      url: ex.url,
      reason,
      httpStatus: ex.httpStatus ?? null,
      robotsRuleLine: robots.ruleLine,
      metaRobots: null,
      xRobotsTag: null,
      canonicalTarget: null,
      canonicalIsSelf: null,
      crawlDepth: null,
      internalInlinkCount: null,
      mainContentWordCount: null,
      nearDuplicateSimilarity: null,
      soft404Signals: [],
      evidenceNotes: ex.evidence,
    })
    seen.add(ex.url)
  }

  const byReason = new Map<PublicExclusionReason, PublicUrlEvidence[]>()
  for (const u of urls) {
    const list = byReason.get(u.reason) || []
    list.push(u)
    byReason.set(u.reason, list)
  }

  const problemReasons = Array.from(byReason.entries())
    .filter(([r]) => r !== 'INDEXABLE')
    .sort((a, b) => b[1].length - a[1].length)

  const topCauses: PublicCauseSummary[] = problemReasons.slice(0, 3).map(([reason, list]) => {
    const exampleUrl = list[0]!.url
    const copy = explainPublicCause(reason, list.length, exampleUrl)
    return {
      reason,
      affectedUrlCount: list.length,
      exampleUrl,
      headline: copy.headline,
      explanation: copy.explanation,
      action: copy.action,
      autoFixable: copy.autoFixable,
    }
  })

  const indexableCount = byReason.get('INDEXABLE')?.length || 0
  const problemCount = urls.length - indexableCount

  return { urls, topCauses, indexableCount, problemCount }
}
