/**
 * Topic 27 — indexable URLs absent from the sitemap.
 *
 * Weakest finding in the block. Six conditions must ALL hold. Follow sitemap
 * indexes before concluding absence. Normalise with normalizeFixStrategyUrl
 * (do NOT collapse trailing slash or path case — that is topic 8/11).
 * Auto-fix only when sitemap is generated from the route tree and omission
 * is a demonstrable generator bug.
 */

import {
  type SitemapInspection,
} from '@/lib/fix-strategies/shared/sitemap-inspect'
import {
  isPathAllowedFromInspection,
  type RobotsTxtInspection,
} from '@/lib/fix-strategies/shared/robots-txt-inspect'
import {
  hasNoindexDirective,
  isSelfCanonical,
  extractHtmlCanonical,
  normalizeFixStrategyUrl,
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic27Verdict =
  | 'report-omission'
  | 'report-omission-orphaned'
  | 'auto-fix-generator-bug'
  | 'suppress-noindex'
  | 'suppress-disallow'
  | 'suppress-canonical-elsewhere'
  | 'suppress-listed-in-index-child'
  | 'route-topic-8-slash-mismatch'
  | 'suppress-parameterised'
  | 'suppress-staging'
  | 'suppress-not-internally-linked'
  | 'suppress-incomplete-conditions'

export type Topic27Finding = {
  kind: 'sitemap/indexable-urls-absent'
  verdict: Topic27Verdict
  severity: 'low' | 'moderate' | null
  pageUrl: string
  detail: string
  autoFixable: boolean
  fixTarget: FixTargetResult
}

export type DetectTopic27Page = {
  url: string
  /** Confirmed 200 on re-fetch (topic 68). */
  status200: boolean
  body: string
  headers?: Headers
  contentType?: string | null
  /** Reachable from the site's own internal links. */
  internallyLinked: boolean
  /** Also absent from internal links → topic 43 orphan elevation. */
  orphaned?: boolean
  /** Paginated / filtered / parameterised variant. */
  parameterised?: boolean
  stagingOrAuth?: boolean
  /** In the generator's route tree but missing from emitted sitemap. */
  generatorShouldInclude?: boolean
}

export type DetectTopic27Result = {
  findings: Topic27Finding[]
  suppressed: Array<{
    pageUrl: string
    verdict: Topic27Verdict
    detail: string
  }>
}

export type DetectTopic27Options = {
  inspection: SitemapInspection
  pages: DetectTopic27Page[]
  robots?: RobotsTxtInspection
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

/**
 * True when `pageNorm` differs from some sitemap loc only by trailing slash
 * or path case — topic 8 / 11, not an omission.
 */
export function isSlashOrCaseMismatch(
  pageNorm: string,
  sitemapLocs: Set<string>,
): boolean {
  let pageUrl: URL
  try {
    pageUrl = new URL(pageNorm)
  } catch {
    return false
  }

  for (const loc of sitemapLocs) {
    let locUrl: URL
    try {
      locUrl = new URL(loc)
    } catch {
      continue
    }
    if (locUrl.origin !== pageUrl.origin) continue
    if (locUrl.search !== pageUrl.search) continue

    // Trailing-slash only
    const a = pageUrl.pathname.replace(/\/$/, '') || '/'
    const b = locUrl.pathname.replace(/\/$/, '') || '/'
    if (a === b && pageUrl.pathname !== locUrl.pathname) return true

    // Path case only
    if (
      pageUrl.pathname.toLowerCase() === locUrl.pathname.toLowerCase() &&
      pageUrl.pathname !== locUrl.pathname
    ) {
      return true
    }
  }
  return false
}

export function detectIndexableUrlsAbsent(
  options: DetectTopic27Options,
): DetectTopic27Result {
  const findings: Topic27Finding[] = []
  const suppressed: DetectTopic27Result['suppressed'] = []

  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/sitemap.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/sitemap.ts',
  })

  const robots = options.robots ?? options.inspection.robots
  const locs = options.inspection.allLocsNormalized

  for (const page of options.pages) {
    const pageNorm =
      normalizeFixStrategyUrl(page.url, options.inspection.originUrl) ??
      page.url

    if (locs.has(pageNorm)) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-listed-in-index-child',
        detail: 'Present in sitemap (possibly via index child)',
      })
      continue
    }

    // Slash / case mismatch vs a listed loc → topic 8/11
    if (isSlashOrCaseMismatch(pageNorm, locs)) {
      findings.push({
        kind: 'sitemap/indexable-urls-absent',
        verdict: 'route-topic-8-slash-mismatch',
        severity: null,
        pageUrl: page.url,
        detail:
          'Sitemap has a slash/case variant of this URL — topic 8/11, not an omission',
        autoFixable: false,
        fixTarget,
      })
      continue
    }

    if (page.stagingOrAuth) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-staging',
        detail: 'Staging/preview/auth-gated — never raise',
      })
      continue
    }

    if (page.parameterised) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-parameterised',
        detail: 'Paginated/filtered/parameterised — may be deliberately omitted',
      })
      continue
    }

    if (!page.status200) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-incomplete-conditions',
        detail: 'Not confirmed 200 — six conditions incomplete',
      })
      continue
    }

    const headers = page.headers ?? new Headers()
    const ct = page.contentType ?? headers.get('content-type') ?? 'text/html'
    if (hasNoindexDirective(headers, page.body, ct)) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-noindex',
        detail: 'Page carries noindex — deliberately excluded',
      })
      continue
    }

    const canonical = extractHtmlCanonical(page.body, page.url, ct)
    if (!isSelfCanonical(page.url, canonical) && canonical != null) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-canonical-elsewhere',
        detail: `Canonicalises elsewhere → ${canonical} (S15)`,
      })
      continue
    }

    let path: string
    try {
      path = new URL(page.url).pathname + new URL(page.url).search
    } catch {
      path = '/'
    }
    const allowed = isPathAllowedFromInspection(robots, 'Googlebot', path)
    if (!allowed.allowed) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-disallow',
        detail: `Disallowed for Googlebot (${allowed.matchedRule})`,
      })
      continue
    }

    if (!page.internallyLinked) {
      // Orphan path: missing internal links elevates + topic 43 (fixture case 7)
      findings.push({
        kind: 'sitemap/indexable-urls-absent',
        verdict: 'report-omission-orphaned',
        severity: 'moderate',
        pageUrl: page.url,
        detail:
          'Indexable and absent from sitemap and internal links — elevated + topic 43. Human-review: adding advertises the URL.',
        autoFixable: false,
        fixTarget,
      })
      continue
    }

    // All six conditions hold
    if (
      page.generatorShouldInclude &&
      options.isGenerated !== false &&
      fixTarget.action === 'fix-generator'
    ) {
      findings.push({
        kind: 'sitemap/indexable-urls-absent',
        verdict: 'auto-fix-generator-bug',
        severity: 'low',
        pageUrl: page.url,
        detail:
          'Generator route-tree should include this URL but omitted it — auto-fix generator',
        autoFixable: true,
        fixTarget,
      })
      continue
    }

    findings.push({
      kind: 'sitemap/indexable-urls-absent',
      verdict: 'report-omission',
      severity: 'low',
      pageUrl: page.url,
      detail:
        'Indexable and internally linked but absent from sitemap (after following indexes). Human-review by default — omission is the weakest finding.',
      autoFixable: false,
      fixTarget,
    })
  }

  return { findings, suppressed }
}
