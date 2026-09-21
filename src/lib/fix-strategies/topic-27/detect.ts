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
  | 'route-topic-8-12-url-variants'
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
 * Path forms that are duplicate-URL variants of each other for sitemap
 * membership (topics 8–12) — slash, case, and directory index.html.
 * Does NOT collapse query (topic 12) or host/scheme (9–10).
 */
export function pathDuplicateForms(pathname: string): string[] {
  const forms = new Set<string>()
  const add = (p: string) => {
    const cleaned = p || '/'
    forms.add(cleaned)
    forms.add(cleaned.toLowerCase())
  }

  add(pathname)
  const trimmed = pathname.replace(/\/+$/, '') || '/'
  add(trimmed)
  if (trimmed !== '/') add(`${trimmed}/`)

  const indexMatch = pathname.match(/^(.*)\/index\.html?$/i)
  if (indexMatch) {
    const dir = indexMatch[1] ?? ''
    add(dir === '' ? '/' : dir)
    if (dir !== '') add(`${dir}/`)
  } else if (pathname === '/' || pathname === '') {
    add('/index.html')
  } else if (pathname.endsWith('/')) {
    add(`${pathname}index.html`)
  } else {
    add(`${pathname}/index.html`)
    add(`${trimmed}/index.html`)
  }

  return [...forms]
}

export type SitemapDuplicateVariantKind = 'slash-or-case' | 'index-html'

/**
 * When a crawled URL is only a duplicate-URL form of a loc already in the
 * sitemap, topic 27 must not raise an omission — route to topics 8–12.
 */
export function classifySitemapDuplicateVariant(
  pageNorm: string,
  sitemapLocs: Set<string>,
): SitemapDuplicateVariantKind | null {
  let pageUrl: URL
  try {
    pageUrl = new URL(pageNorm)
  } catch {
    return null
  }

  const pageForms = pathDuplicateForms(pageUrl.pathname)
  const pageIsIndex = /\/index\.html?$/i.test(pageUrl.pathname)

  for (const loc of sitemapLocs) {
    let locUrl: URL
    try {
      locUrl = new URL(loc)
    } catch {
      continue
    }
    if (locUrl.origin !== pageUrl.origin) continue
    if (locUrl.search !== pageUrl.search) continue

    const locForms = pathDuplicateForms(locUrl.pathname)
    const overlap = pageForms.some((f) => locForms.includes(f))
    if (!overlap) continue
    // Exact same path (after normalize) already handled by locs.has
    if (pageUrl.pathname === locUrl.pathname) continue

    const locIsIndex = /\/index\.html?$/i.test(locUrl.pathname)
    if (pageIsIndex !== locIsIndex) return 'index-html'

    // Trailing-slash only
    const a = pageUrl.pathname.replace(/\/$/, '') || '/'
    const b = locUrl.pathname.replace(/\/$/, '') || '/'
    if (a === b && pageUrl.pathname !== locUrl.pathname) return 'slash-or-case'

    // Path case only
    if (
      pageUrl.pathname.toLowerCase() === locUrl.pathname.toLowerCase() &&
      pageUrl.pathname !== locUrl.pathname
    ) {
      return 'slash-or-case'
    }

    // Directory vs index.html already returned; other pathDuplicateForms
    // overlaps (e.g. /blog vs /blog/index.html via form expansion) → index-html
    return 'index-html'
  }
  return null
}

/**
 * True when `pageNorm` differs from some sitemap loc only by trailing slash
 * or path case — topic 8 / 11, not an omission.
 * @deprecated Prefer classifySitemapDuplicateVariant (also covers index.html).
 */
export function isSlashOrCaseMismatch(
  pageNorm: string,
  sitemapLocs: Set<string>,
): boolean {
  return classifySitemapDuplicateVariant(pageNorm, sitemapLocs) === 'slash-or-case'
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

    // Slash / case / index.html mismatch vs a listed loc → topics 8–12
    const variantKind = classifySitemapDuplicateVariant(pageNorm, locs)
    if (variantKind === 'slash-or-case') {
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
    if (variantKind === 'index-html') {
      findings.push({
        kind: 'sitemap/indexable-urls-absent',
        verdict: 'route-topic-8-12-url-variants',
        severity: null,
        pageUrl: page.url,
        detail:
          'Sitemap lists a directory-index variant of this URL (e.g. /blog vs /blog/index.html) — topic 8 duplicate URL form, not an omission',
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
