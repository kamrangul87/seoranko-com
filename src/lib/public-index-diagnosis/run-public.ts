/**
 * Public Index Diagnosis runner — reuses runIndexCrawl, maps to public reasons.
 */

import {
  PUBLIC_SCAN_DEADLINE_MS,
  PUBLIC_SCAN_MAX_DEPTH,
  PUBLIC_SCAN_MAX_DISCOVERED,
  PUBLIC_SCAN_MAX_FETCHED,
} from './rate-limit'
import type { PublicCauseSummary, PublicUrlEvidence } from './types'

export type PublicScanErrorCode =
  | 'invalid_domain'
  | 'unreachable'
  | 'robots_blocks_all'
  | 'site_too_large'
  | 'rate_limited'
  | 'busy'
  | 'scan_failed'

export type PublicScanResult = {
  ok: true
  domain: string
  seedUrl: string
  scannedAt: string
  urlsDiscovered: number
  urlsFetched: number
  partial: boolean
  terminationReason: string
  terminationEvidence: string
  topCauses: PublicCauseSummary[]
  indexableCount: number
  problemCount: number
  urls: PublicUrlEvidence[]
  evidence: Record<string, unknown>
}

export type PublicScanFailure = {
  ok: false
  code: PublicScanErrorCode
  message: string
}

const PUBLIC_CRAWL = {
  maxDiscovered: PUBLIC_SCAN_MAX_DISCOVERED,
  maxFetched: PUBLIC_SCAN_MAX_FETCHED,
  maxDepth: PUBLIC_SCAN_MAX_DEPTH,
}

export async function runPublicIndexDiagnosis(
  seedUrl: string,
): Promise<PublicScanResult | PublicScanFailure> {
  const deadlineMs = Date.now() + PUBLIC_SCAN_DEADLINE_MS
  let crawl
  try {
    crawl = await runIndexCrawl(seedUrl, { ...PUBLIC_CRAWL, deadlineMs })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/not allowed|URL is not allowed/i.test(msg)) {
      return { ok: false, code: 'invalid_domain', message: msg }
    }
    return {
      ok: false,
      code: 'unreachable',
      message: `Could not crawl this site: ${msg}`,
    }
  }

  // Seed blocked by robots → clear error
  const seedRobots = matchRobotsForUrl(crawl.robotsTxt, crawl.homepageUrl)
  if (!seedRobots.allowed) {
    return {
      ok: false,
      code: 'robots_blocks_all',
      message: `robots.txt blocks crawling the homepage (${seedRobots.ruleLine || seedRobots.evidence}). Remove or narrow that Disallow rule to scan the site.`,
    }
  }

  // If every discovered URL is robots-disallowed and nothing fetched
  if (
    crawl.fetchedPages.length === 0 &&
    crawl.coverage.excluded.length > 0 &&
    crawl.coverage.excluded.every((e) => e.reason === 'ROBOTS_DISALLOWED')
  ) {
    return {
      ok: false,
      code: 'robots_blocks_all',
      message:
        'robots.txt appears to block every URL we tried to fetch. Adjust Disallow rules, then scan again.',
    }
  }

  if (crawl.fetchedPages.length === 0) {
    return {
      ok: false,
      code: 'unreachable',
      message:
        crawl.coverage.robotsTxtEvidence ||
        'The site did not return any fetchable pages. It may be down or blocking automated crawlers.',
    }
  }

  const classified = classifyPublicScan({
    coverage: crawl.coverage,
    fetchedPages: crawl.fetchedPages,
    robotsTxt: crawl.robotsTxt,
  })

  const partial =
    crawl.coverage.terminationReason === 'FETCH_BUDGET_EXHAUSTED' ||
    crawl.coverage.terminationReason === 'DISCOVERY_CAP_REACHED' ||
    crawl.coverage.terminationReason === 'PLAN_LIMIT_REACHED' ||
    /time budget/i.test(crawl.coverage.terminationEvidence)

  const siteTooLargeHint =
    crawl.coverage.discoveredCount >= PUBLIC_CRAWL.maxDiscovered ||
    crawl.coverage.terminationReason === 'DISCOVERY_CAP_REACHED'

  // Soft message flag for UI — still return results when we have pages
  const evidence = {
    coverage: {
      domain: crawl.coverage.domain,
      seedUrl: crawl.coverage.seedUrl,
      discoveredCount: crawl.coverage.discoveredCount,
      fetchedCount: crawl.coverage.fetchedCount,
      terminationReason: crawl.coverage.terminationReason,
      terminationEvidence: crawl.coverage.terminationEvidence,
      robotsTxtFetched: crawl.coverage.robotsTxtFetched,
      robotsTxtEvidence: crawl.coverage.robotsTxtEvidence,
      excludedByReason: crawl.coverage.excludedByReason,
    },
    robotsTxtSnippet: crawl.robotsTxt.slice(0, 4000),
    siteTooLargeHint,
    classifiedUrlCount: classified.urls.length,
  }

  return {
    ok: true,
    domain: crawl.coverage.domain,
    seedUrl: crawl.coverage.seedUrl,
    scannedAt: new Date().toISOString(),
    urlsDiscovered: crawl.coverage.discoveredCount,
    urlsFetched: crawl.coverage.fetchedCount,
    partial,
    terminationReason: crawl.coverage.terminationReason,
    terminationEvidence: crawl.coverage.terminationEvidence,
    topCauses: classified.topCauses,
    indexableCount: classified.indexableCount,
    problemCount: classified.problemCount,
    urls: classified.urls,
    evidence,
  }
}
