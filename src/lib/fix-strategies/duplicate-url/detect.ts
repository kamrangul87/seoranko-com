/**
 * ONE detector for duplicate-URL topics 8–12.
 *
 * Variant generation is the only strategy-specific step
 * (`generateVariant` with six strategies). Content sameness must be proven.
 * When a discovery set is provided, a generated peer absent from crawl /
 * sitemap / internal links is GENERATED-ONLY (informational), not actionable.
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import {
  generateVariant,
  isSiteRootUrl,
  type DuplicateUrlStrategy,
  type VariantPair,
} from '@/lib/fix-strategies/shared/duplicate-url-variants'
import { proveContentSameness } from '@/lib/fix-strategies/shared/content-sameness'
import {
  derivePreferredForm,
  type PreferredFormResult,
  type PreferredFormSignals,
} from '@/lib/fix-strategies/shared/preferred-form'
import {
  recordRedirectHops,
  resolveFixTarget,
  normalizeFixStrategyUrl,
  type FixTargetResult,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'
import {
  allParamsAreTracking,
  classifyDuplicateUrl,
  hasAuthOrSignedParam,
  type DuplicateUrlVerdict,
} from './classify'

export type VariantDiscoverability = 'discovered' | 'generated-only'

export type DuplicateUrlFinding = {
  kind: `duplicate-url/${DuplicateUrlStrategy}`
  strategy: DuplicateUrlStrategy
  topic: 8 | 9 | 10 | 11 | 12
  urlA: string
  urlB: string
  verdict: DuplicateUrlVerdict
  detail: string
  preferred: PreferredFormResult
  preferCanonicalOverRedirect: boolean
  contentSame: boolean
  fixTarget: FixTargetResult
  /** Collapsible config / artefact site for rollup (e.g. config:next.config.js). */
  declarationSite: string
  /** Whether the generated peer was found in crawl/sitemap/links. */
  discoverability: VariantDiscoverability
  /** 12b report payload */
  paramNames?: string[]
}

export type DetectDuplicateUrlResult = {
  findings: DuplicateUrlFinding[]
  informational: DuplicateUrlFinding[]
  suppressed: Array<{
    url: string
    strategy: DuplicateUrlStrategy
    verdict: DuplicateUrlVerdict
    detail: string
  }>
  reportOnly: Array<{
    url: string
    strategy: DuplicateUrlStrategy
    detail: string
    paramNames: string[]
  }>
}

export type DetectDuplicateUrlPage = {
  url: string
  /** Optional pre-fetched body for the seed URL (avoids re-fetch). */
  body?: string
  uppercasePathHint?: string | null
}

export type DetectDuplicateUrlOptions = {
  strategy: DuplicateUrlStrategy
  deps: HopRecordingDeps
  signals?: PreferredFormSignals
  /**
   * Normalized URLs known from the crawl frontier, sitemap locs, or internal
   * links. When set, a generated peer absent from this set is GENERATED-ONLY
   * (informational) — not an actionable finding. Omit in unit fixtures to
   * skip the gate.
   */
  discoveredNormalized?: Set<string>
  httpsExceptions?: {
    invalidTls?: boolean
    mixedContent?: boolean
    httpsRedirectsToHttp?: boolean
    httpsCanonicalPointsHttp?: boolean
  }
  fixOutsideRepo?: boolean
  middlewareIndeterminate?: boolean
  /** Rejected if true for path-case. */
  blanketLowercaseProposed?: boolean
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

const STRATEGY_TOPIC: Record<DuplicateUrlStrategy, 8 | 9 | 10 | 11 | 12> = {
  'trailing-slash': 8,
  'index-html': 8,
  'http-https': 9,
  'www-non-www': 10,
  'path-case': 11,
  'query-params': 12,
}

function urlInDiscovered(url: string, discovered?: Set<string>): boolean {
  if (!discovered) return true
  const n = normalizeFixStrategyUrl(url)
  return n != null && discovered.has(n)
}

async function fetchManual(
  url: string,
  deps: HopRecordingDeps,
): Promise<{ status: number; body: string; location: string | null }> {
  const res = await deps.fetch(url, { method: 'GET', redirect: 'manual' })
  const location = res.headers.get('location')
  let body = ''
  if (res.status >= 200 && res.status < 300) {
    body = await res.text()
  }
  return { status: res.status, body, location }
}

function redirectsToPeer(
  status: number,
  location: string | null,
  peer: string,
  base: string,
): boolean {
  if (status < 300 || status >= 400 || !location) return false
  try {
    const dest = new URL(location, base).href
    const a = new URL(peer)
    const b = new URL(dest)
    return (
      a.protocol === b.protocol &&
      a.host === b.host &&
      a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '') &&
      a.search === b.search
    )
  } catch {
    return false
  }
}

export async function detectDuplicateUrls(
  pages: DetectDuplicateUrlPage[],
  options: DetectDuplicateUrlOptions,
): Promise<DetectDuplicateUrlResult> {
  const findings: DuplicateUrlFinding[] = []
  const informational: DuplicateUrlFinding[] = []
  const suppressed: DetectDuplicateUrlResult['suppressed'] = []
  const reportOnly: DetectDuplicateUrlResult['reportOnly'] = []

  const artefactPath = options.artefactPath ?? 'next.config.js'
  const fixTarget = resolveFixTarget({
    artefactPath,
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })
  const declarationSite = `config:${artefactPath}`

  const allowlist = FIX_STRATEGY_PRODUCT_DECISIONS.trackingParameterAllowlist

  for (const page of pages) {
    if (
      options.strategy === 'trailing-slash' &&
      isSiteRootUrl(page.url)
    ) {
      suppressed.push({
        url: page.url,
        strategy: options.strategy,
        verdict: 'suppress-site-root',
        detail: 'Site root excluded',
      })
      continue
    }

    const pair = generateVariant(page.url, options.strategy, {
      uppercaseHint: page.uppercasePathHint,
    })
    if (!pair) {
      suppressed.push({
        url: page.url,
        strategy: options.strategy,
        verdict: 'suppress-not-applicable',
        detail: 'No distinct opposite variant for this strategy',
      })
      continue
    }

    const result = await assessPair(
      pair,
      page,
      options,
      fixTarget,
      declarationSite,
      allowlist,
    )
    if (result.kind === 'suppressed') {
      suppressed.push(result.entry)
    } else if (result.kind === 'report') {
      reportOnly.push(result.entry)
    } else if (result.kind === 'informational') {
      informational.push(result.finding)
    } else {
      findings.push(result.finding)
    }
  }

  return { findings, informational, suppressed, reportOnly }
}

type AssessResult =
  | {
      kind: 'suppressed'
      entry: DetectDuplicateUrlResult['suppressed'][number]
    }
  | {
      kind: 'report'
      entry: DetectDuplicateUrlResult['reportOnly'][number]
    }
  | { kind: 'informational'; finding: DuplicateUrlFinding }
  | { kind: 'finding'; finding: DuplicateUrlFinding }

async function assessPair(
  pair: VariantPair,
  page: DetectDuplicateUrlPage,
  options: DetectDuplicateUrlOptions,
  fixTarget: FixTargetResult,
  declarationSite: string,
  allowlist: readonly string[],
): Promise<AssessResult> {
  const strategy = options.strategy
  const topic = STRATEGY_TOPIC[strategy]

  const urlA = pair.a
  const urlB = pair.b

  const fa = await fetchManual(urlA, options.deps)
  const fb = await fetchManual(urlB, options.deps)

  const statusA = fa.status
  let bodyA = fa.body
  const locA = fa.location
  const statusB = fb.status
  const bodyB = fb.body
  const locB = fb.location

  if (
    statusA === 200 &&
    page.body != null &&
    (page.url === pair.a || normalizeLoose(page.url) === normalizeLoose(pair.a))
  ) {
    bodyA = page.body
  }

  const aToB = redirectsToPeer(statusA, locA, urlB, urlA)
  const bToA = redirectsToPeer(statusB, locB, urlA, urlB)
  if (aToB || bToA) {
    return {
      kind: 'suppressed',
      entry: {
        url: page.url,
        strategy,
        verdict: 'ok-already-normalises',
        detail: 'One form redirects to the other',
      },
    }
  }

  if (statusA !== 200 || statusB !== 200) {
    return {
      kind: 'suppressed',
      entry: {
        url: page.url,
        strategy,
        verdict: 'suppress-not-applicable',
        detail: `Statuses ${statusA}/${statusB} — need both 200`,
      },
    }
  }

  const confirm = await fetchManual(urlB, options.deps)
  if (confirm.status !== 200) {
    return {
      kind: 'suppressed',
      entry: {
        url: page.url,
        strategy,
        verdict: 'suppress-not-applicable',
        detail: 'Variant 200 not stable across re-fetch (topic 68)',
      },
    }
  }

  const sameness = proveContentSameness(bodyA!, confirm.body || bodyB)
  const preferred = derivePreferredForm(
    urlA,
    urlB,
    strategy,
    options.signals ?? {},
  )

  const allTracking = allParamsAreTracking(pair.paramNames, allowlist)
  const authParam = hasAuthOrSignedParam(pair.paramNames)

  const classified = classifyDuplicateUrl({
    strategy,
    alreadyRedirects: false,
    contentSame: sameness.same,
    isSiteRoot: false,
    preferred,
    httpsExceptions: options.httpsExceptions,
    blanketLowercaseProposed: options.blanketLowercaseProposed,
    allParamsTracking: allTracking,
    hasAuthOrSignedParam: authParam,
    fixOutsideRepo: options.fixOutsideRepo,
    middlewareIndeterminate: options.middlewareIndeterminate,
  })

  if (
    classified.verdict.startsWith('suppress-') ||
    classified.verdict === 'ok-already-normalises' ||
    classified.verdict === 'indeterminate-middleware'
  ) {
    return {
      kind: 'suppressed',
      entry: {
        url: page.url,
        strategy,
        verdict: classified.verdict,
        detail: classified.detail,
      },
    }
  }

  if (classified.verdict === 'report-only-12b') {
    return {
      kind: 'report',
      entry: {
        url: page.url,
        strategy,
        detail: classified.detail,
        paramNames: pair.paramNames,
      },
    }
  }

  // Discoverability: pair.b is the generated opposite. Absent from discovery
  // set → GENERATED-ONLY (informational at most).
  const peerDiscovered = urlInDiscovered(urlB, options.discoveredNormalized)
  const discoverability: VariantDiscoverability = peerDiscovered
    ? 'discovered'
    : 'generated-only'

  const finding: DuplicateUrlFinding = {
    kind: `duplicate-url/${strategy}`,
    strategy,
    topic,
    urlA,
    urlB,
    verdict: classified.verdict,
    detail: classified.detail,
    preferred,
    preferCanonicalOverRedirect: classified.preferCanonicalOverRedirect,
    contentSame: sameness.same,
    fixTarget,
    declarationSite,
    discoverability,
    paramNames: pair.paramNames.length > 0 ? pair.paramNames : undefined,
  }

  if (discoverability === 'generated-only') {
    return {
      kind: 'informational',
      finding: {
        ...finding,
        verdict: 'informational-generated-only',
        detail: `${classified.detail} — variant ${urlB} is GENERATED-ONLY (not in crawl, sitemap, or internal links); informational at most`,
      },
    }
  }

  return { kind: 'finding', finding }
}

function normalizeLoose(u: string): string {
  try {
    return new URL(u).href
  } catch {
    return u
  }
}

/** Expose hop recorder for verifiers that need full chains. */
export { recordRedirectHops }
