/**
 * Run shipped HTML-level detectors on crawled pages.
 * Detectors themselves are unchanged — this only calls them.
 *
 * PER-PAGE detectors run per chunk. WHOLE-SITE detectors run once when the
 * frontier is exhausted via runWholeSiteDetectorsOnCrawl (same fix class as
 * topic 43 — chunk graphs invent false findings).
 */

import {
  extractStructuredData,
  extractCanonicalDeclarations,
  inspectDocumentHead,
  buildInternalLinkGraph,
  rollupFindingsByDeclarationSite,
  inspectSiteSitemaps,
  hasNoindexDirective,
  extractHtmlCanonical,
  normalizeFixStrategyUrl,
  type HopRecordingDeps,
  type RollupFindingInput,
} from '@/lib/fix-strategies/shared'
import { detectBrokenInternalLinks } from '@/lib/fix-strategies/topic-1'
import { detectPotentialSoft404 } from '@/lib/fix-strategies/topic-2b'
import {
  detect5xxResponses,
  type FetchAttemptRecord,
} from '@/lib/fix-strategies/topic-3'
import { detectRedirectTopics } from '@/lib/fix-strategies/topic-4'
import {
  detectTrailingSlashDuplicates,
  detectIndexHtmlDuplicates,
} from '@/lib/fix-strategies/topic-8'
import { detectHttpHttpsDuplicates } from '@/lib/fix-strategies/topic-9'
import { detectWwwNonWwwDuplicates } from '@/lib/fix-strategies/topic-10'
import { detectPathCaseDuplicates } from '@/lib/fix-strategies/topic-11'
import { detectQueryParamDuplicates } from '@/lib/fix-strategies/topic-12'
import { detectCanonicalAbsent } from '@/lib/fix-strategies/topic-13'
import { detectCanonicalTargetNot200 } from '@/lib/fix-strategies/topic-14'
import { detectCanonicalPointsToNoindexed } from '@/lib/fix-strategies/topic-15'
import { detectHtmlHeaderCanonicalDisagree } from '@/lib/fix-strategies/topic-16'
import { detectMultipleCanonicals } from '@/lib/fix-strategies/topic-17'
import { detectNoindexShouldIndex } from '@/lib/fix-strategies/topic-19'
import { detectMetaHeaderDisagree } from '@/lib/fix-strategies/topic-20'
import { detectBlockedRenderResources } from '@/lib/fix-strategies/topic-21'
import { detectRobotsTxtIssues } from '@/lib/fix-strategies/topic-22'
import { detectSitemapMissingOrUnreachable } from '@/lib/fix-strategies/topic-24'
import { detectSitemapXmlInvalid } from '@/lib/fix-strategies/topic-25'
import { detectSitemapNotIndexable } from '@/lib/fix-strategies/topic-26'
import { detectIndexableUrlsAbsent } from '@/lib/fix-strategies/topic-27'
import { detectSitemapNotReferencedInRobots } from '@/lib/fix-strategies/topic-28'
import { detectTagsOutsideHead } from '@/lib/fix-strategies/topic-29'
import { detectTitleMissingOrMalformed } from '@/lib/fix-strategies/topic-30'
import { detectMetaDescriptionIssues } from '@/lib/fix-strategies/topic-31'
import { detectDuplicateTitlesDescriptions } from '@/lib/fix-strategies/topic-33'
import { detectLangDeclaration } from '@/lib/fix-strategies/topic-34'
import { detectRequiredPropertiesAbsent } from '@/lib/fix-strategies/topic-35'
import { detectSchemaUrlsDontResolve } from '@/lib/fix-strategies/topic-36'
import { detectInvalidOrMismatchedType } from '@/lib/fix-strategies/topic-37'
import { detectStructuredDataContradictsVisible } from '@/lib/fix-strategies/topic-38'
import { detectDeprecatedTypes } from '@/lib/fix-strategies/topic-39'
import { detectLinksThroughRedirects } from '@/lib/fix-strategies/topic-42'
import { detectOrphanPages } from '@/lib/fix-strategies/topic-43'
import { detectCrawlDepth } from '@/lib/fix-strategies/topic-45'
import { detectMissingReturnLinks } from '@/lib/fix-strategies/topic-46'
import { detectInvalidLanguageRegionCodes } from '@/lib/fix-strategies/topic-47'
import { detectAlternateTargetNotIndexable } from '@/lib/fix-strategies/topic-48'
import { detectImgMissingDimensions } from '@/lib/fix-strategies/topic-49'
import {
  assertAllShippedTopicsWired,
  assertChunkLoopTopics,
  assertPostCrawlTopics,
  CHUNK_LOOP_TOPIC_IDS,
  POST_CRAWL_TOPIC_IDS,
} from '@/lib/fix-strategies/detector-scope'
import { classifyVerdictBucket, classifySurfaceClass } from '../buckets'
import { sourcesForDossier } from '../sources'
import { dossierSlugForTopic } from '../topic-registry'
import type { CrawledPage } from './fetch-page'
import { CRAWL_INTER_REQUEST_GAP_MS } from './constants'
import type { FetchDeps, FetchOutcome } from '@/lib/fix-strategies/fetch/types'

export type DetectorEmit = {
  topicId: string
  kind: string
  verdict: string
  severity: string | null
  detail: string
  pageUrl: string
  declarationSite: string | null
  autoFixable: boolean
  proposedDiff: Record<string, unknown> | null
  evidenceValues: Record<string, unknown> | null
  bucket: 'actionable' | 'informational' | 'internal'
}

// Guard at module load: chunk-wired ids must stay PER-PAGE; post-crawl WHOLE-SITE;
// every shipped DETECTOR_SCOPE topic must be wired.
assertChunkLoopTopics(CHUNK_LOOP_TOPIC_IDS)
assertPostCrawlTopics(POST_CRAWL_TOPIC_IDS)
assertAllShippedTopicsWired()

function makeGapFetchDeps(): FetchDeps {
  let lastAt = 0
  return {
    fetch: globalThis.fetch.bind(globalThis),
    now: () => Date.now(),
    sleep: async (ms: number) => {
      const since = Date.now() - lastAt
      const wait = Math.max(ms, CRAWL_INTER_REQUEST_GAP_MS - since, 0)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastAt = Date.now()
    },
  }
}

function hopDepsFromFetch(deps: FetchDeps): HopRecordingDeps {
  return { fetch: deps.fetch }
}

function mapFetchAttempt(outcome: FetchOutcome): FetchAttemptRecord {
  if (outcome.kind === 'http') {
    return {
      status: outcome.status,
      kind: 'http',
      headers: outcome.headers,
    }
  }
  if (outcome.kind === 'network-error') {
    return { status: null, kind: 'network' }
  }
  return { status: null, kind: outcome.kind }
}

function ingestArray(
  topicId: string,
  kindDefault: string,
  items: unknown[],
  out: DetectorEmit[],
  opts?: {
    defaultVerdict?: string
    /** Forced bucket for internal audit-trail arrays (suppressed/ok/…). */
    forceBucket?: DetectorEmit['bucket']
  },
): void {
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const verdict = String(
      item.verdict ?? item.reason ?? opts?.defaultVerdict ?? '',
    ).trim()
    // Skip malformed rows (e.g. ok[] entries that only have pageUrl/detail
    // were previously defaulting to "unknown" and polluting actionable).
    if (!verdict) continue
    const memberUrls = Array.isArray(item.memberUrls)
      ? (item.memberUrls as unknown[]).filter((u) => typeof u === 'string')
      : []
    const pageUrl = String(
      item.pageUrl ??
        item.sourceUrl ??
        item.url ??
        item.urlA ??
        (memberUrls[0] as string | undefined) ??
        '',
    )
    const declarationSite =
      typeof item.declarationSite === 'string' ? item.declarationSite : null
    out.push({
      topicId,
      kind: String(item.kind ?? kindDefault),
      verdict,
      severity:
        typeof item.severity === 'string' || item.severity === null
          ? (item.severity as string | null)
          : null,
      detail: typeof item.detail === 'string' ? item.detail : '',
      pageUrl,
      declarationSite,
      autoFixable: item.autoFixable === true,
      proposedDiff:
        item.proposed && typeof item.proposed === 'object'
          ? { proposed: item.proposed }
          : item.proposedFromHeading
            ? { proposedFromHeading: item.proposedFromHeading }
            : null,
      evidenceValues:
        item.values && typeof item.values === 'object'
          ? (item.values as Record<string, unknown>)
          : item.depth != null || item.shortestPath != null
            ? {
                depth: item.depth ?? null,
                shortestPath: item.shortestPath ?? null,
                renderRequired: item.renderRequired ?? false,
              }
            : null,
      bucket: opts?.forceBucket ?? classifyVerdictBucket(verdict),
    })
  }
}

function takeBuckets(
  topicId: string,
  kind: string,
  result: unknown,
  out: DetectorEmit[],
  pageUrlFallback?: string,
): void {
  if (!result || typeof result !== 'object') return
  const r = result as Record<string, unknown>
  const inject = (items: unknown[]): unknown[] => {
    if (!pageUrlFallback) return items
    return items.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw
      const item = raw as Record<string, unknown>
      if (item.pageUrl || item.sourceUrl || item.url || item.urlA) return raw
      return { ...item, pageUrl: pageUrlFallback }
    })
  }
  // Surface buckets (metrics = topic 45 architecture reporting)
  for (const key of ['findings', 'informational', 'metrics'] as const) {
    const arr = r[key]
    if (Array.isArray(arr)) ingestArray(topicId, kind, inject(arr), out)
  }
  // Internal audit trail — never surface as actionable (topic 1/42 use
  // bare `reason` strings like scheme-filter / status-200).
  for (const key of [
    'observations',
    'suppressed',
    'routed',
    'routedCauses',
    'ok',
  ] as const) {
    const arr = r[key]
    if (!Array.isArray(arr)) continue
    ingestArray(topicId, kind, inject(arr), out, {
      defaultVerdict: key === 'ok' ? 'ok' : undefined,
      forceBucket: 'internal',
    })
  }
}

/**
 * PER-PAGE detectors across a chunk of crawled pages (same origin).
 * WHOLE-SITE detectors are deliberately excluded — see runWholeSiteDetectorsOnCrawl.
 */
export async function runDetectorsOnPages(
  origin: string,
  pages: CrawledPage[],
): Promise<DetectorEmit[]> {
  void origin
  const out: DetectorEmit[] = []
  const usable = pages.filter(
    (p) =>
      p.streamComplete &&
      !p.clientOnly &&
      !p.crawlerCausedBackoff &&
      p.html &&
      p.status != null &&
      p.status >= 200 &&
      p.status < 400,
  )

  const jsonLdSite = 'generator:site-jsonld'
  const imgSite = 'generator:site-images'
  const fetchDeps = makeGapFetchDeps()
  const hopDeps = hopDepsFromFetch(fetchDeps)
  const dupPages = usable.map((p) => ({ url: p.finalUrl, body: p.html }))

  // Batch-style PER-PAGE detectors — each page is independent;
  // running on a chunk does not invent cross-URL false positives.
  if (usable.length > 0) {
    // Topics 4–7: one redirect walk, four topic emits
    {
      const { findings } = await detectRedirectTopics(
        usable.map((p) => ({ url: p.finalUrl })),
        { deps: hopDeps },
      )
      for (const f of findings) {
        for (const [id, kind, part] of [
          ['4', 'redirect/chain', f.topic4],
          ['5', 'redirect/loop', f.topic5],
          ['6', 'redirect/temporary-where-permanent', f.topic6],
          ['7', 'redirect/target-not-200', f.topic7],
        ] as const) {
          takeBuckets(
            id,
            kind,
            { findings: [{ ...part, pageUrl: f.originUrl }] },
            out,
          )
        }
      }
    }

    // Topics 8–12: duplicate URL forms
    takeBuckets(
      '8',
      'duplicate-url/trailing-slash',
      await detectTrailingSlashDuplicates(dupPages, { deps: hopDeps }),
      out,
    )
    takeBuckets(
      '8',
      'duplicate-url/index-html',
      await detectIndexHtmlDuplicates(dupPages, { deps: hopDeps }),
      out,
    )
    takeBuckets(
      '9',
      'duplicate-url/http-https',
      await detectHttpHttpsDuplicates(dupPages, { deps: hopDeps }),
      out,
    )
    takeBuckets(
      '10',
      'duplicate-url/www-non-www',
      await detectWwwNonWwwDuplicates(dupPages, { deps: hopDeps }),
      out,
    )
    takeBuckets(
      '11',
      'duplicate-url/path-case',
      await detectPathCaseDuplicates(dupPages, { deps: hopDeps }),
      out,
    )
    takeBuckets(
      '12',
      'duplicate-url/query-params',
      await detectQueryParamDuplicates(dupPages, { deps: hopDeps }),
      out,
    )

    takeBuckets(
      '13',
      'canonical/tag-absent',
      detectCanonicalAbsent(
        usable.map((p) => ({
          url: p.finalUrl,
          body: p.html,
          headers: p.headers,
          duplicatesProven: false,
        })),
      ),
      out,
    )
    takeBuckets(
      '14',
      'canonical/target-not-200',
      await detectCanonicalTargetNot200(
        usable.map((p) => ({
          url: p.finalUrl,
          body: p.html,
          headers: p.headers,
          pageReturns200: p.status === 200,
        })),
        { deps: hopDeps },
      ),
      out,
    )
    takeBuckets(
      '16',
      'canonical/html-header-disagree',
      detectHtmlHeaderCanonicalDisagree(
        usable.map((p) => ({
          url: p.finalUrl,
          body: p.html,
          headers: p.headers,
        })),
      ),
      out,
    )
    takeBuckets(
      '17',
      'canonical/multiple-tags',
      detectMultipleCanonicals(
        usable.map((p) => ({
          url: p.finalUrl,
          body: p.html,
          headers: p.headers,
        })),
      ),
      out,
    )
    takeBuckets(
      '20',
      'indexability/meta-header-disagree',
      detectMetaHeaderDisagree(
        usable.map((p) => ({
          url: p.finalUrl,
          body: p.html,
          headers: p.headers,
        })),
      ),
      out,
    )
    takeBuckets(
      '42',
      'internal-links/through-redirects',
      await detectLinksThroughRedirects(
        usable.map((p) => ({ url: p.finalUrl, html: p.html })),
        { deps: fetchDeps },
      ),
      out,
    )
  }

  for (const p of usable) {
    const pageUrl = p.finalUrl
    const extraction = extractStructuredData(p.html, pageUrl)
    const head = inspectDocumentHead(p.html)
    void extractCanonicalDeclarations

    // Topic 1: broken internal links (network)
    takeBuckets(
      '1',
      'internal-links/broken',
      await detectBrokenInternalLinks(p.html, p.finalUrl, {
        deps: fetchDeps,
      }),
      out,
      pageUrl,
    )

    // Topic 2b: potential soft 404
    takeBuckets(
      '2b',
      'indexability/potential-soft-404',
      detectPotentialSoft404({
        pageUrl,
        status: p.status,
        html: p.html,
        contentClientOnly: p.clientOnly,
      }),
      out,
      pageUrl,
    )

    // Topic 3: 5xx — only with ≥2 fetch attempts
    if (p.evidence.attempts.length >= 2) {
      takeBuckets(
        '3',
        'availability/5xx',
        detect5xxResponses({
          pageUrl,
          attempts: p.evidence.attempts.map(mapFetchAttempt),
          liveStatus: p.status,
        }),
        out,
        pageUrl,
      )
    }

    takeBuckets(
      '29',
      'head/tags-outside-head',
      detectTagsOutsideHead({ inspection: head }),
      out,
      pageUrl,
    )
    takeBuckets(
      '30',
      'head/missing-or-malformed-title',
      detectTitleMissingOrMalformed({
        page: {
          inspection: head,
          status200: p.status === 200,
          headers: p.headers,
          body: p.html,
        },
      }),
      out,
      pageUrl,
    )
    takeBuckets(
      '31',
      'head/missing-meta-description',
      detectMetaDescriptionIssues({
        page: {
          inspection: head,
          status200: p.status === 200,
          headers: p.headers,
          body: p.html,
        },
      }),
      out,
      pageUrl,
    )
    takeBuckets(
      '34',
      'head/missing-or-wrong-lang',
      detectLangDeclaration({ inspection: head }),
      out,
      pageUrl,
    )
    takeBuckets(
      '35',
      'structured-data/required-properties-absent',
      detectRequiredPropertiesAbsent({
        html: p.html,
        pageUrl,
        extraction,
      }),
      out,
      pageUrl,
    )
    // Topic 36: probes omitted (partial OK). Findings use `url` for the
    // schema property value — map pageUrl explicitly so ingestArray does
    // not treat that property URL as the crawl page.
    {
      const t36 = detectSchemaUrlsDontResolve({
        html: p.html,
        pageUrl,
        extraction,
      })
      takeBuckets(
        '36',
        'structured-data/urls-dont-resolve',
        {
          ...t36,
          findings: t36.findings.map((f) => ({ ...f, pageUrl })),
        },
        out,
        pageUrl,
      )
    }
    takeBuckets(
      '37',
      'structured-data/invalid-or-mismatched-type',
      detectInvalidOrMismatchedType({
        html: p.html,
        pageUrl,
        extraction,
      }),
      out,
      pageUrl,
    )
    takeBuckets(
      '38',
      'structured-data/contradicts-visible-page',
      detectStructuredDataContradictsVisible({
        html: p.html,
        pageUrl,
        extraction,
        declarationSite: jsonLdSite,
      }),
      out,
      pageUrl,
    )
    takeBuckets(
      '39',
      'structured-data/deprecated-types',
      detectDeprecatedTypes({
        html: p.html,
        pageUrl,
        extraction,
      }),
      out,
      pageUrl,
    )

    const img = await detectImgMissingDimensions(p.html, pageUrl, {
      fetch,
      isGenerated: true,
      generatorPath: imgSite,
      declarationSite: imgSite,
    })
    takeBuckets('49', 'performance/img-missing-dimensions', img, out, pageUrl)
  }

  return out
}

export type WholeSitePageInput = {
  url: string
  html: string
  status: number | null
  clientOnly: boolean
  inSitemap?: boolean
  headers?: Headers
}

/**
 * WHOLE-SITE detectors — run once when the frontier is drained.
 * Covers sitemap set (24/25/26/27/28), robots (19/21/22), cross-URL head (33),
 * link graph (43/45), canonical→noindex (15), and hreflang (46/47/48).
 */
export async function runWholeSiteDetectorsOnCrawl(
  origin: string,
  pages: WholeSitePageInput[],
): Promise<DetectorEmit[]> {
  const out: DetectorEmit[] = []
  if (pages.length === 0) return out

  const usableHtml = pages.filter(
    (p) =>
      !p.clientOnly &&
      p.html &&
      p.status != null &&
      p.status >= 200 &&
      p.status < 400,
  )

  const fetchDeps = makeGapFetchDeps()

  // Build crawl map for topic 15 target resolution
  const crawlByNorm = new Map<string, WholeSitePageInput>()
  for (const p of pages) {
    const norm = normalizeFixStrategyUrl(p.url) ?? p.url.replace(/\/$/, '')
    crawlByNorm.set(norm, p)
    crawlByNorm.set(p.url, p)
    crawlByNorm.set(p.url.replace(/\/$/, ''), p)
  }

  // --- Sitemap / robots site artefacts (22, 24, 25, 26, 27, 28) ---
  let inspection: Awaited<ReturnType<typeof inspectSiteSitemaps>> | null = null
  try {
    inspection = await inspectSiteSitemaps({
      originUrl: origin,
      deps: fetchDeps,
    })
    takeBuckets(
      '24',
      'sitemap/missing-or-unreachable',
      detectSitemapMissingOrUnreachable({ inspection }),
      out,
      `${origin}/sitemap.xml`,
    )
    takeBuckets(
      '25',
      'sitemap/xml-invalid',
      detectSitemapXmlInvalid({ inspection }),
      out,
      `${origin}/sitemap.xml`,
    )
    takeBuckets(
      '28',
      'sitemap/not-referenced-in-robots',
      detectSitemapNotReferencedInRobots({ inspection }),
      out,
      `${origin}/robots.txt`,
    )

    // Topic 22: reuse robots inspection from sitemap inspect when available
    takeBuckets(
      '22',
      'robots/invalid-or-unreachable',
      await detectRobotsTxtIssues({
        originUrl: origin,
        deps: hopDepsFromFetch(fetchDeps),
        inspection: inspection.robots,
      }),
      out,
      `${origin}/robots.txt`,
    )

    // Topic 26: each urlset document with a body
    for (const doc of inspection.documents) {
      if (!doc.body || !doc.parsed || doc.parsed.kind !== 'urlset') continue
      const detected = await detectSitemapNotIndexable(
        doc.body,
        {
          artefactPath: doc.url,
          isGenerated: true,
          generatorPath: null,
          appDir: 'app',
          siteOrigin: origin,
        },
        fetchDeps,
      )
      takeBuckets(
        '26',
        'sitemap/not-indexable',
        {
          findings: detected.findings.map((f) => ({
            ...f,
            pageUrl: f.loc,
          })),
          ok: detected.ok.map((loc) => ({ pageUrl: loc, verdict: 'ok' })),
        },
        out,
        doc.url,
      )
    }
  } catch {
    // Site-level sitemap inspect failure is recorded as coverage elsewhere;
    // still try topic 22 without a shared inspection.
    try {
      takeBuckets(
        '22',
        'robots/invalid-or-unreachable',
        await detectRobotsTxtIssues({
          originUrl: origin,
          deps: hopDepsFromFetch(fetchDeps),
        }),
        out,
        `${origin}/robots.txt`,
      )
    } catch {
      // do not abort other whole-site detectors
    }
  }

  // Topic 21: blocked render resources (needs robots inspection)
  if (usableHtml.length > 0) {
    takeBuckets(
      '21',
      'robots/blocked-render-resources',
      detectBlockedRenderResources(
        usableHtml.map((p) => ({
          url: p.url,
          html: p.html,
          headers: p.headers,
          indexable:
            (p.status ?? 0) === 200 &&
            !hasNoindexDirective(
              p.headers ?? new Headers(),
              p.html,
              'text/html',
            ),
        })),
        inspection?.robots ?? null,
      ),
      out,
    )
  }

  // Link graph once for 27 (internallyLinked), 43, 45
  const hasClientOnlyPages = pages.some((p) => p.clientOnly)
  const graphPages = pages
    .filter((p) => p.html || p.clientOnly)
    .map((p) => ({
      url: p.url,
      html: p.clientOnly ? '' : p.html,
      status: p.status,
      inSitemap: p.inSitemap === true,
    }))
  const graph = buildInternalLinkGraph({
    originUrl: origin,
    pages: graphPages,
  })
  const inboundLinked = new Set(
    graph.edges.filter((e) => e.crawlable).map((e) => e.toNormalized),
  )
  // Homepage is reachable by definition
  if (graph.homepageNormalized) inboundLinked.add(graph.homepageNormalized)

  if (inspection) {
    takeBuckets(
      '27',
      'sitemap/indexable-urls-absent',
      detectIndexableUrlsAbsent({
        inspection,
        pages: usableHtml.map((p) => {
          const norm =
            normalizeFixStrategyUrl(p.url) ?? p.url.replace(/\/$/, '')
          return {
            url: p.url,
            status200: (p.status ?? 0) === 200,
            body: p.html,
            headers: p.headers,
            internallyLinked:
              inboundLinked.has(norm) ||
              inboundLinked.has(p.url.replace(/\/$/, '')),
          }
        }),
      }),
      out,
      `${origin}/sitemap.xml`,
    )
  }

  // --- Topic 15: canonical points to noindexed (resolve target from crawl) ---
  for (const p of usableHtml) {
    const headers = p.headers ?? new Headers()
    const extraction = extractCanonicalDeclarations(
      p.html,
      headers,
      p.url,
      'text/html',
    )
    const decl =
      extraction.effectiveHead ??
      (extraction.header.length === 1 ? extraction.header[0]! : null)
    const targetNorm = decl?.normalized ?? null
    let targetPage: WholeSitePageInput | null = null
    if (targetNorm) {
      targetPage =
        crawlByNorm.get(targetNorm) ??
        crawlByNorm.get(targetNorm.replace(/\/$/, '')) ??
        null
    }
    takeBuckets(
      '15',
      'canonical/points-to-noindexed',
      detectCanonicalPointsToNoindexed({
        pageUrl: p.url,
        html: p.html,
        headers,
        target: targetPage
          ? {
              url: targetPage.url,
              status: targetPage.status ?? 0,
              html: targetPage.html,
              headers: targetPage.headers,
              repoNoindex: 'indeterminate',
            }
          : null,
      }),
      out,
      p.url,
    )
  }

  // --- Topic 19: noindex that should index (inSitemap from inspection) ---
  if (usableHtml.length > 0) {
    const sitemapLocs = inspection?.allLocsNormalized ?? new Set<string>()
    takeBuckets(
      '19',
      'indexability/noindex-should-index',
      detectNoindexShouldIndex(
        usableHtml.map((p) => {
          const norm =
            normalizeFixStrategyUrl(p.url) ?? p.url.replace(/\/$/, '')
          return {
            url: p.url,
            body: p.html,
            headers: p.headers,
            inSitemap:
              p.inSitemap === true ||
              sitemapLocs.has(norm) ||
              sitemapLocs.has(p.url) ||
              sitemapLocs.has(p.url.replace(/\/$/, '')),
            repoNoindex: 'indeterminate' as const,
          }
        }),
      ),
      out,
    )
  }

  // --- Topic 33: duplicate titles/descriptions across full crawl set ---
  if (usableHtml.length >= 2) {
    const topic33Pages = usableHtml.map((p) => {
      const head = inspectDocumentHead(p.html)
      const noindex = hasNoindexDirective(
        p.headers ?? new Headers(),
        p.html,
        'text/html',
      )
      const canonical = extractHtmlCanonical(p.html, p.url, 'text/html')
      return {
        url: p.url,
        inspection: head,
        indexable: (p.status ?? 0) === 200 && !noindex,
        canonicalTarget: canonical
          ? normalizeFixStrategyUrl(canonical, p.url)
          : null,
      }
    })
    takeBuckets(
      '33',
      'head/duplicate-titles-descriptions',
      detectDuplicateTitlesDescriptions({ pages: topic33Pages }),
      out,
    )
  }

  // --- Topic 43: orphans (full-run graph) ---
  takeBuckets(
    '43',
    'internal-links/orphan-pages',
    detectOrphanPages({ graph, hasClientOnlyPages }),
    out,
  )

  // --- Topic 45: crawl depth (same graph) ---
  takeBuckets(
    '45',
    'internal-links/crawl-depth',
    detectCrawlDepth({ graph }),
    out,
  )

  // --- Topics 46/47/48: hreflang (same collect) ---
  if (usableHtml.length > 0) {
    const hreflangCollect = {
      originUrl: origin,
      pages: usableHtml.map((p) => ({
        url: p.url,
        html: p.html,
        headers: p.headers,
        status: p.status,
      })),
      sitemap: inspection,
    }
    takeBuckets(
      '46',
      'hreflang/missing-return-links',
      detectMissingReturnLinks({ collect: hreflangCollect }),
      out,
    )
    takeBuckets(
      '47',
      'hreflang/invalid-language-region-codes',
      detectInvalidLanguageRegionCodes({ collect: hreflangCollect }),
      out,
    )
    takeBuckets(
      '48',
      'hreflang/alternate-target-not-indexable',
      detectAlternateTargetNotIndexable({ collect: hreflangCollect }),
      out,
    )
  }

  return out
}

/**
 * @deprecated Prefer runWholeSiteDetectorsOnCrawl — kept for call-site clarity
 * in tests that only assert topic 43.
 */
export async function runTopic43OnCrawl(
  origin: string,
  pages: WholeSitePageInput[],
): Promise<DetectorEmit[]> {
  const all = await runWholeSiteDetectorsOnCrawl(origin, pages)
  return all.filter((e) => e.topicId === '43')
}

export type RolledPersistCandidate = {
  topicId: string
  kind: string
  verdict: string
  severity: string | null
  detail: string
  pageUrl: string | null
  declarationSite: string | null
  rollupKey: string
  affectedUrlCount: number
  rolledUp: boolean
  bucket: 'actionable' | 'informational' | 'internal'
  autoFixable: boolean
  reportOnly: boolean
  surfaceClass: string
  proposedDiff: Record<string, unknown> | null
  evidenceValues: Record<string, unknown> | null
  sourceRows: unknown[]
}

export function rollupAndClassify(emits: DetectorEmit[]): {
  findings: RolledPersistCandidate[]
  internalEvidence: DetectorEmit[]
} {
  const internalEvidence = emits.filter((e) => e.bucket === 'internal')
  const surface = emits.filter((e) => e.bucket !== 'internal')

  const rollupInputs: RollupFindingInput[] = surface.map((e) => ({
    topicId: e.topicId,
    verdict: e.verdict,
    pageUrl: e.pageUrl || 'unknown',
    declarationSite: e.declarationSite,
    severity: e.severity,
    detail: e.detail,
    payload: {
      kind: e.kind,
      autoFixable: e.autoFixable,
      proposedDiff: e.proposedDiff,
      evidenceValues: e.evidenceValues,
      bucket: e.bucket,
    },
  }))

  const rolled = rollupFindingsByDeclarationSite(rollupInputs)
  const findings: RolledPersistCandidate[] = rolled.map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>
    const bucket =
      (payload.bucket as RolledPersistCandidate['bucket']) ??
      classifyVerdictBucket(r.verdict)
    const autoFixable = payload.autoFixable === true
    const reportOnly = bucket === 'informational' || !autoFixable
    const surfaceClass = classifySurfaceClass(r.verdict, {
      autoFixable,
      reportOnly,
    })
    const declarationSite = r.declarationSite
    const rollupKey = [
      r.topicId,
      r.verdict,
      declarationSite ?? r.pageUrl ?? '',
    ].join('|')
    const dossier = dossierSlugForTopic(r.topicId)
    return {
      topicId: r.topicId,
      kind: String(payload.kind ?? `topic/${r.topicId}`),
      verdict: r.verdict,
      severity: r.severity ?? null,
      detail: r.detail ?? '',
      pageUrl: r.rolledUp ? r.memberUrls[0] ?? r.pageUrl : r.pageUrl,
      declarationSite,
      rollupKey,
      affectedUrlCount: r.affectedUrlCount,
      rolledUp: r.rolledUp,
      bucket,
      autoFixable,
      reportOnly,
      surfaceClass,
      proposedDiff:
        (payload.proposedDiff as Record<string, unknown> | null) ?? null,
      evidenceValues:
        (payload.evidenceValues as Record<string, unknown> | null) ?? null,
      sourceRows: sourcesForDossier(dossier),
    }
  })

  return { findings, internalEvidence }
}
