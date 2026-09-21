/**
 * Run shipped HTML-level detectors on crawled pages.
 * Detectors themselves are unchanged — this only calls them.
 */

import {
  extractStructuredData,
  extractCanonicalDeclarations,
  inspectDocumentHead,
  buildInternalLinkGraph,
  rollupFindingsByDeclarationSite,
  inspectSiteSitemaps,
  type RollupFindingInput,
} from '@/lib/fix-strategies/shared'
import { detectStructuredDataContradictsVisible } from '@/lib/fix-strategies/topic-38'
import { detectImgMissingDimensions } from '@/lib/fix-strategies/topic-49'
import { detectRequiredPropertiesAbsent } from '@/lib/fix-strategies/topic-35'
import { detectDeprecatedTypes } from '@/lib/fix-strategies/topic-39'
import { detectInvalidOrMismatchedType } from '@/lib/fix-strategies/topic-37'
import { detectLangDeclaration } from '@/lib/fix-strategies/topic-34'
import { detectOrphanPages } from '@/lib/fix-strategies/topic-43'
import { detectCanonicalAbsent } from '@/lib/fix-strategies/topic-13'
import { detectMultipleCanonicals } from '@/lib/fix-strategies/topic-17'
import { detectTitleMissingOrMalformed } from '@/lib/fix-strategies/topic-30'
import { detectMetaDescriptionIssues } from '@/lib/fix-strategies/topic-31'
import { detectTagsOutsideHead } from '@/lib/fix-strategies/topic-29'
import { detectSitemapXmlInvalid } from '@/lib/fix-strategies/topic-25'
import { detectSitemapMissingOrUnreachable } from '@/lib/fix-strategies/topic-24'
import { detectSitemapNotReferencedInRobots } from '@/lib/fix-strategies/topic-28'
import { detectIndexableUrlsAbsent } from '@/lib/fix-strategies/topic-27'
import { classifyVerdictBucket, classifySurfaceClass } from '../buckets'
import { sourcesForDossier } from '../sources'
import { dossierSlugForTopic } from '../topic-registry'
import type { CrawledPage } from './fetch-page'
import { CRAWL_INTER_REQUEST_GAP_MS } from './constants'
import type { FetchDeps } from '@/lib/fix-strategies/fetch/types'

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

function ingestArray(
  topicId: string,
  kindDefault: string,
  items: unknown[],
  out: DetectorEmit[],
  opts?: { defaultVerdict?: string },
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
    const pageUrl = String(
      item.pageUrl ?? item.sourceUrl ?? item.url ?? '',
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
          : null,
      bucket: classifyVerdictBucket(verdict),
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
      if (item.pageUrl || item.sourceUrl || item.url) return raw
      return { ...item, pageUrl: pageUrlFallback }
    })
  }
  // Surface buckets
  for (const key of ['findings', 'informational'] as const) {
    const arr = r[key]
    if (Array.isArray(arr)) ingestArray(topicId, kind, inject(arr), out)
  }
  // Internal audit trail — normalize ok[] which often omit verdict
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
    })
  }
}

/**
 * Run detectors across a set of crawled pages (same origin).
 * Site-level sitemap detectors run once when `runSiteLevel` is true
 * (first tick / full batch) so topics 24–28 are included.
 */
export async function runDetectorsOnPages(
  origin: string,
  pages: CrawledPage[],
  opts?: { runSiteLevel?: boolean },
): Promise<DetectorEmit[]> {
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

  if (opts?.runSiteLevel !== false) {
    try {
      let lastAt = 0
      const deps: FetchDeps = {
        fetch: globalThis.fetch.bind(globalThis),
        now: () => Date.now(),
        sleep: async (ms: number) => {
          const since = Date.now() - lastAt
          const wait = Math.max(ms, CRAWL_INTER_REQUEST_GAP_MS - since, 0)
          if (wait > 0) await new Promise((r) => setTimeout(r, wait))
          lastAt = Date.now()
        },
      }
      const inspection = await inspectSiteSitemaps({ originUrl: origin, deps })
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
      takeBuckets(
        '27',
        'sitemap/indexable-urls-absent',
        detectIndexableUrlsAbsent({
          inspection,
          pages: usable.map((p) => ({
            url: p.finalUrl,
            status200: (p.status ?? 0) === 200,
            body: p.html,
            headers: p.headers,
            internallyLinked: true,
          })),
        }),
        out,
        `${origin}/sitemap.xml`,
      )
    } catch {
      // Site-level sitemap inspect failure is recorded as coverage elsewhere;
      // do not abort page detectors.
    }
  }

  // Batch-style detectors (topic 13 / 17)
  if (usable.length > 0) {
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
  }

  for (const p of usable) {
    const pageUrl = p.finalUrl
    const extraction = extractStructuredData(p.html, pageUrl)
    const head = inspectDocumentHead(p.html)
    void extractCanonicalDeclarations

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

  // Topic 43 runs once on the full crawl set (see runTopic43OnCrawl) so
  // chunk boundaries cannot invent orphans.

  return out
}

/**
 * Build the full-run link graph and run topic 43.
 * Includes client_only pages as empty shells so the incomplete-evidence
 * guard can fire; HTML pages contribute crawlable <a href> edges.
 */
export async function runTopic43OnCrawl(
  origin: string,
  pages: Array<{
    url: string
    html: string
    status: number | null
    clientOnly: boolean
    inSitemap?: boolean
  }>,
): Promise<DetectorEmit[]> {
  const out: DetectorEmit[] = []
  if (pages.length === 0) return out

  const hasClientOnlyPages = pages.some((p) => p.clientOnly)
  const graphPages = pages
    .filter((p) => p.html || p.clientOnly)
    .map((p) => ({
      url: p.url,
      // client_only shells contribute no crawlable edges (empty / minimal HTML)
      html: p.clientOnly ? '' : p.html,
      status: p.status,
      inSitemap: p.inSitemap === true,
    }))

  const graph = buildInternalLinkGraph({
    originUrl: origin,
    pages: graphPages,
  })
  takeBuckets(
    '43',
    'internal-links/orphan-pages',
    detectOrphanPages({ graph, hasClientOnlyPages }),
    out,
  )
  return out
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
