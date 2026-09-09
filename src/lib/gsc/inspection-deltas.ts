/**
 * Mechanical deltas: our crawl vs Google URL Inspection.
 * Enum-primary classification — coverageState is display/evidence only.
 * Never claims "why Google won't rank".
 */

export type InspectionDeltaReason =
  | 'crawl_indexable_google_not_indexed'
  | 'crawl_blocked_google_indexed'
  | 'canonical_mismatch'
  | 'robots_state_conflict'
  | 'indexing_directive_conflict'
  | 'fetch_state_conflict'
  | 'google_not_recrawled_since_fix'
  | 'no_successful_google_crawl_recorded'
  | 'historical_transition'

export type InspectionDelta = {
  reason: InspectionDeltaReason
  explanation: string
  evidence: Record<string, unknown>
  fixAgentKind: 'redirect-canonical' | null
  humanTaskKind:
    | 'gsc-not-indexed'
    | 'gsc-canonical-mismatch'
    | 'gsc-robots-conflict'
    | 'gsc-never-crawled'
    | 'gsc-blocked-but-indexed'
    | 'gsc-indexing-directive'
    | 'gsc-fetch-state'
    | 'gsc-post-fix-recrawl'
    | 'gsc-historical-transition'
    | null
}

export type OurIndexingDirective = 'none' | 'noindex_meta' | 'noindex_header' | 'unknown'

export type CrawlSnapshotForDelta = {
  ourVerdict: 'INDEXABLE' | 'BLOCKED' | 'AT_RISK' | null
  ourRobotsBlocked: boolean
  /** Optional — when omitted, fetch-state conflicts are not emitted. */
  ourHttpStatus?: number | null
  /** Optional — when omitted, indexing-directive conflicts are not emitted. */
  ourIndexingDirective?: OurIndexingDirective
  inSitemap: boolean
}

export type GoogleInspectionForDelta = {
  /** Display/evidence only — never primary classifier. */
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

export type VerifiedInterventionForDelta = {
  id: string
  verifiedAt: string
}

export type HistoricalInspectionForDelta = {
  id: string
  inspectedAt: string
  verdict: string | null
  indexingState: string | null
  googleCanonical: string | null
  pageFetchState: string | null
  robotsTxtState: string | null
}

/** Primary: structured enums (verdict + indexingState). coverageState is evidence only. */
export function googleLooksIndexed(opts: {
  indexingState: string | null
  verdict: string | null
  /** @deprecated evidence only — ignored for primary classification */
  coverageState?: string | null
}): boolean {
  const idx = (opts.indexingState || '').toUpperCase()
  const verd = (opts.verdict || '').toUpperCase()
  if (
    idx === 'BLOCKED_BY_META_TAG' ||
    idx === 'BLOCKED_BY_HTTP_HEADER' ||
    idx === 'BLOCKED_BY_ROBOTS_TXT'
  ) {
    return false
  }
  // Google IndexStatusResult.verdict PASS = URL is on Google (enum, not coverage prose).
  if (verd === 'PASS') return true
  return false
}

export function googleRobotsAllows(robotsTxtState: string | null): boolean | null {
  if (!robotsTxtState) return null
  const s = robotsTxtState.toUpperCase()
  if (s === 'ALLOWED') return true
  if (s === 'DISALLOWED') return false
  return null
}

const FETCH_PROBLEM = new Set([
  'SOFT_404',
  'NOT_FOUND',
  'SERVER_ERROR',
  'ACCESS_DENIED',
  'ACCESS_FORBIDDEN',
  'REDIRECT_ERROR',
  'BLOCKED_4XX',
])

export function computeInspectionDeltas(
  crawl: CrawlSnapshotForDelta,
  google: GoogleInspectionForDelta,
  opts?: {
    verifiedIntervention?: VerifiedInterventionForDelta | null
    previous?: HistoricalInspectionForDelta | null
  },
): InspectionDelta[] {
  const deltas: InspectionDelta[] = []

  const indexed = googleLooksIndexed({
    indexingState: google.indexingState,
    verdict: google.verdict,
  })

  if (crawl.ourVerdict === 'INDEXABLE' && !indexed) {
    deltas.push({
      reason: 'crawl_indexable_google_not_indexed',
      explanation:
        "Our current crawl marked this URL indexable, but Google's last recorded view is not indexed " +
        '(indexingState / verdict enums). Observed difference only — not a ranking explanation.',
      evidence: {
        our_verdict: crawl.ourVerdict,
        indexing_state: google.indexingState,
        google_verdict: google.verdict,
        coverage_state_display: google.coverageState,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-not-indexed',
    })
  }

  if (crawl.ourVerdict === 'BLOCKED' && indexed) {
    deltas.push({
      reason: 'crawl_blocked_google_indexed',
      explanation:
        "Our current crawl marked this URL blocked, but Google's last recorded view reports it as indexed. " +
        'Observed difference — review robots/meta directives and accidental indexation risk.',
      evidence: {
        our_verdict: crawl.ourVerdict,
        indexing_state: google.indexingState,
        google_verdict: google.verdict,
        coverage_state_display: google.coverageState,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-blocked-but-indexed',
    })
  }

  if (google.canonicalMismatch) {
    deltas.push({
      reason: 'canonical_mismatch',
      explanation:
        "Declared canonical and Google-selected canonical differ after normalization " +
        '(scheme+host lowercased; path/query case preserved). Align tags or redirects.',
      evidence: {
        user_canonical: google.userCanonical,
        google_canonical: google.googleCanonical,
      },
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
          "Our current crawl treated this URL as robots-blocked, but Google's last recorded robotsTxtState is ALLOWED.",
        evidence: { our_robots_blocked: true, robots_txt_state: google.robotsTxtState },
        fixAgentKind: null,
        humanTaskKind: 'gsc-robots-conflict',
      })
    } else if (!crawl.ourRobotsBlocked && gRobots === false) {
      deltas.push({
        reason: 'robots_state_conflict',
        explanation:
          "Our current crawl did not treat this URL as robots-blocked, but Google's last recorded robotsTxtState is DISALLOWED.",
        evidence: { our_robots_blocked: false, robots_txt_state: google.robotsTxtState },
        fixAgentKind: null,
        humanTaskKind: 'gsc-robots-conflict',
      })
    }
  }

  const ourDirective: OurIndexingDirective = crawl.ourIndexingDirective ?? 'unknown'
  const ourHttpStatus = crawl.ourHttpStatus ?? null
  const idxEnum = (google.indexingState || '').toUpperCase()
  if (
    ourDirective === 'noindex_meta' &&
    idxEnum !== 'BLOCKED_BY_META_TAG' &&
    indexed
  ) {
    deltas.push({
      reason: 'indexing_directive_conflict',
      explanation:
        "Our crawl observed a meta robots noindex, but Google's indexingState is not BLOCKED_BY_META_TAG " +
        '(and Google reports indexed). Observed difference between directive and recorded state.',
      evidence: {
        our_indexing_directive: ourDirective,
        indexing_state: google.indexingState,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-indexing-directive',
    })
  }
  if (
    ourDirective === 'noindex_header' &&
    idxEnum !== 'BLOCKED_BY_HTTP_HEADER' &&
    indexed
  ) {
    deltas.push({
      reason: 'indexing_directive_conflict',
      explanation:
        "Our crawl observed an X-Robots-Tag noindex, but Google's indexingState is not BLOCKED_BY_HTTP_HEADER " +
        '(and Google reports indexed). Observed difference between directive and recorded state.',
      evidence: {
        our_indexing_directive: ourDirective,
        indexing_state: google.indexingState,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-indexing-directive',
    })
  }
  if (
    ourDirective === 'none' &&
    (idxEnum === 'BLOCKED_BY_META_TAG' || idxEnum === 'BLOCKED_BY_HTTP_HEADER')
  ) {
    deltas.push({
      reason: 'indexing_directive_conflict',
      explanation:
        "Our crawl did not observe a noindex directive, but Google's indexingState records a block " +
        `(${idxEnum}). Observed difference — re-check live HTML headers.`,
      evidence: {
        our_indexing_directive: ourDirective,
        indexing_state: google.indexingState,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-indexing-directive',
    })
  }

  const fetchState = (google.pageFetchState || '').toUpperCase()
  if (ourHttpStatus !== null && ourHttpStatus >= 200 && ourHttpStatus < 400) {
    if (FETCH_PROBLEM.has(fetchState)) {
      deltas.push({
        reason: 'fetch_state_conflict',
        explanation:
          `Our current crawl fetched HTTP ${ourHttpStatus}, but Google's last recorded pageFetchState is ${fetchState}. ` +
          "Observed difference between our fetch evidence and Google's recorded view.",
        evidence: {
          our_http_status: ourHttpStatus,
          page_fetch_state: google.pageFetchState,
        },
        fixAgentKind: null,
        humanTaskKind: 'gsc-fetch-state',
      })
    }
  }
  if (ourHttpStatus !== null && ourHttpStatus >= 400 && fetchState === 'SUCCESSFUL') {
    deltas.push({
      reason: 'fetch_state_conflict',
      explanation:
        `Our current crawl observed HTTP ${ourHttpStatus}, but Google's last recorded pageFetchState is SUCCESSFUL. ` +
        'Observed difference — one side may be stale.',
      evidence: {
        our_http_status: ourHttpStatus,
        page_fetch_state: google.pageFetchState,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-fetch-state',
    })
  }

  if (!google.lastCrawlTime) {
    deltas.push({
      reason: 'no_successful_google_crawl_recorded',
      explanation:
        'No successful Google crawl is recorded for this URL (missing lastCrawlTime). ' +
        'Google only guarantees that a missing lastCrawlTime means no recorded successful crawl, ' +
        'not that Google never tried.',
      evidence: {
        last_crawl_time: null,
        in_sitemap: crawl.inSitemap,
        coverage_state_display: google.coverageState,
      },
      fixAgentKind: null,
      humanTaskKind: 'gsc-never-crawled',
    })
  }

  const vi = opts?.verifiedIntervention
  if (vi?.verifiedAt && google.lastCrawlTime) {
    const crawlMs = Date.parse(google.lastCrawlTime)
    const verifiedMs = Date.parse(vi.verifiedAt)
    if (Number.isFinite(crawlMs) && Number.isFinite(verifiedMs) && crawlMs < verifiedMs) {
      deltas.push({
        reason: 'google_not_recrawled_since_fix',
        explanation:
          'Google has not recorded a successful crawl since this verified fix.',
        evidence: {
          last_crawl_time: google.lastCrawlTime,
          verified_at: vi.verifiedAt,
          intervention_id: vi.id,
        },
        fixAgentKind: null,
        humanTaskKind: 'gsc-post-fix-recrawl',
      })
    }
  }

  const prev = opts?.previous
  if (prev) {
    const transitions: Array<{ field: string; from: string | null; to: string | null }> = []
    const wasIndexed = googleLooksIndexed({
      indexingState: prev.indexingState,
      verdict: prev.verdict,
    })
    if (wasIndexed !== indexed) {
      transitions.push({
        field: 'indexed',
        from: wasIndexed ? 'indexed' : 'not_indexed',
        to: indexed ? 'indexed' : 'not_indexed',
      })
    }
    if (
      (prev.googleCanonical || null) !== (google.googleCanonical || null) &&
      (prev.googleCanonical || google.googleCanonical)
    ) {
      transitions.push({
        field: 'google_canonical',
        from: prev.googleCanonical,
        to: google.googleCanonical,
      })
    }
    const prevFetch = (prev.pageFetchState || '').toUpperCase()
    if (prevFetch === 'SUCCESSFUL' && FETCH_PROBLEM.has(fetchState)) {
      transitions.push({
        field: 'page_fetch_state',
        from: prev.pageFetchState,
        to: google.pageFetchState,
      })
    }
    const prevRobots = googleRobotsAllows(prev.robotsTxtState)
    const nowRobots = googleRobotsAllows(google.robotsTxtState)
    if (prevRobots === true && nowRobots === false) {
      transitions.push({
        field: 'robots_txt_state',
        from: prev.robotsTxtState,
        to: google.robotsTxtState,
      })
    }
    for (const t of transitions) {
      deltas.push({
        reason: 'historical_transition',
        explanation: `Observed historical transition on ${t.field}: ${t.from ?? '∅'} → ${t.to ?? '∅'}.`,
        evidence: {
          field: t.field,
          previous_value: t.from,
          current_value: t.to,
          previous_inspection_id: prev.id,
          previous_inspected_at: prev.inspectedAt,
        },
        fixAgentKind: null,
        humanTaskKind: 'gsc-historical-transition',
      })
    }
  }

  return deltas
}

export function deltaReasonLabel(reason: InspectionDeltaReason): string {
  switch (reason) {
    case 'crawl_indexable_google_not_indexed':
      return 'Our crawl indexable · Google not indexed'
    case 'crawl_blocked_google_indexed':
      return 'Our crawl blocked · Google indexed'
    case 'canonical_mismatch':
      return 'Canonical mismatch'
    case 'robots_state_conflict':
      return 'Robots state conflict'
    case 'indexing_directive_conflict':
      return 'Indexing directive conflict'
    case 'fetch_state_conflict':
      return 'Fetch state conflict'
    case 'google_not_recrawled_since_fix':
      return 'No Google crawl since verified fix'
    case 'no_successful_google_crawl_recorded':
      return 'No successful Google crawl recorded'
    case 'historical_transition':
      return 'Historical transition'
    default:
      return reason
  }
}

/** Banned ranking-cause phrases — used by UI tests. */
export const BANNED_RANKING_CLAIM_RE =
  /why google won'?t rank|ranking cause|will not rank|won't rank|algorithm(?:ic)? (?:penalty|boost)/i
