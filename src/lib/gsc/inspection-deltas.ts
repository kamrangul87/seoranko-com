/**
 * Mechanical deltas: our crawl/index diagnosis vs Google URL Inspection.
 * Evidence-only — never claims "why Google won't rank".
 */

export type InspectionDeltaReason =
  | 'crawl_indexable_google_not_indexed'
  | 'canonical_mismatch'
  | 'robots_state_conflict'
  | 'sitemap_never_crawled'

export type InspectionDelta = {
  reason: InspectionDeltaReason
  /** Plain-English, grounded — no algorithm speculation. */
  explanation: string
  evidence: Record<string, unknown>
  /** Fix Agent auto kind, or null when human-only. */
  fixAgentKind: 'redirect-canonical' | null
  humanTaskKind:
    | 'gsc-not-indexed'
    | 'gsc-canonical-mismatch'
    | 'gsc-robots-conflict'
    | 'gsc-never-crawled'
    | null
}

export type CrawlSnapshotForDelta = {
  ourVerdict: 'INDEXABLE' | 'BLOCKED' | 'AT_RISK' | null
  /** True when our crawl recorded robots_txt / meta / x-robots block. */
  ourRobotsBlocked: boolean
  /** URL appears in live sitemap discovery list. */
  inSitemap: boolean
}

export type GoogleInspectionForDelta = {
  coverageState: string | null
  robotsTxtState: string | null
  indexingState: string | null
  googleCanonical: string | null
  userCanonical: string | null
  canonicalMismatch: boolean
  lastCrawlTime: string | null
  pageFetchState: string | null
  verdict: string | null
}

/** Google strings that indicate the URL is treated as indexed. */
export function googleLooksIndexed(opts: {
  coverageState: string | null
  indexingState: string | null
  verdict: string | null
}): boolean {
  const cov = (opts.coverageState || '').toLowerCase()
  const idx = (opts.indexingState || '').toLowerCase()
  const verd = (opts.verdict || '').toUpperCase()
  if (verd === 'PASS' && /indexed/i.test(cov || idx || 'indexed')) return true
  if (/submitted and indexed|indexed, not submitted|indexed/i.test(cov)) {
    if (/not indexed|excluded|error|blocked/i.test(cov)) return false
    return true
  }
  if (/^indexed$/i.test(idx)) return true
  return false
}

export function googleRobotsAllows(robotsTxtState: string | null): boolean | null {
  if (!robotsTxtState) return null
  const s = robotsTxtState.toUpperCase()
  if (s === 'ALLOWED') return true
  if (s === 'DISALLOWED') return false
  return null
}

/**
 * Compute mechanical deltas between our crawl snapshot and Google inspection.
 */
export function computeInspectionDeltas(
  crawl: CrawlSnapshotForDelta,
  google: GoogleInspectionForDelta,
): InspectionDelta[] {
  const deltas: InspectionDelta[] = []

  const indexed = googleLooksIndexed({
    coverageState: google.coverageState,
    indexingState: google.indexingState,
    verdict: google.verdict,
  })

  if (crawl.ourVerdict === 'INDEXABLE' && !indexed) {
    deltas.push({
      reason: 'crawl_indexable_google_not_indexed',
      explanation:
        'Our crawl marked this URL indexable, but Google’s recorded coverage state is not indexed. ' +
        'That is Google’s stored index status — not a ranking explanation. Review content quality and ' +
        'request indexing in Search Console if appropriate; SEORANKO will not auto-“fix” this.',
      evidence: {
        our_verdict: crawl.ourVerdict,
        coverage_state: google.coverageState,
        indexing_state: google.indexingState,
        google_verdict: google.verdict,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-not-indexed',
    })
  }

  if (google.canonicalMismatch) {
    deltas.push({
      reason: 'canonical_mismatch',
      explanation:
        'Your declared canonical (userCanonical) differs from the URL Google selected (googleCanonical). ' +
        'Align the canonical tag or redirects so both agree on one URL.',
      evidence: {
        user_canonical: google.userCanonical,
        google_canonical: google.googleCanonical,
      },
      // Existing Fix Agent strategy when from→to redirect is mechanical.
      fixAgentKind: google.userCanonical && google.googleCanonical ? 'redirect-canonical' : null,
      humanTaskKind: 'gsc-canonical-mismatch',
    })
  }

  const gRobots = googleRobotsAllows(google.robotsTxtState)
  if (gRobots !== null) {
    if (crawl.ourRobotsBlocked && gRobots === true) {
      deltas.push({
        reason: 'robots_state_conflict',
        explanation:
          'Our crawl treated this URL as robots-blocked, but Google’s robotsTxtState is ALLOWED. ' +
          'Re-check robots.txt and meta robots — one side is stale or mismatched.',
        evidence: {
          our_robots_blocked: true,
          robots_txt_state: google.robotsTxtState,
        },
        fixAgentKind: null,
        humanTaskKind: 'gsc-robots-conflict',
      })
    } else if (!crawl.ourRobotsBlocked && gRobots === false) {
      deltas.push({
        reason: 'robots_state_conflict',
        explanation:
          'Our crawl did not treat this URL as robots-blocked, but Google’s robotsTxtState is DISALLOWED. ' +
          'Confirm robots.txt rules for this path and whether the property URL matches the crawled host.',
        evidence: {
          our_robots_blocked: false,
          robots_txt_state: google.robotsTxtState,
        },
        fixAgentKind: null,
        humanTaskKind: 'gsc-robots-conflict',
      })
    }
  }

  if (crawl.inSitemap && !google.lastCrawlTime) {
    deltas.push({
      reason: 'sitemap_never_crawled',
      explanation:
        'This URL is listed in your sitemap, but Google’s inspection result has no lastCrawlTime. ' +
        'Google has not recorded a crawl of this URL yet (or the field was empty).',
      evidence: {
        in_sitemap: true,
        last_crawl_time: null,
        coverage_state: google.coverageState,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-never-crawled',
    })
  }

  return deltas
}

/** Stable plain labels for UI chips. */
export function deltaReasonLabel(reason: InspectionDeltaReason): string {
  switch (reason) {
    case 'crawl_indexable_google_not_indexed':
      return 'Crawl indexable · Google not indexed'
    case 'canonical_mismatch':
      return 'Canonical mismatch'
    case 'robots_state_conflict':
      return 'Robots state conflict'
    case 'sitemap_never_crawled':
      return 'In sitemap · never crawled'
    default:
      return reason
  }
}
