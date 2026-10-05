/**
 * Resumable post-crawl phase machine.
 *
 * After the URL frontier drains:
 * 1. Persist inspectSiteSitemaps + buildInternalLinkGraph once per run
 * 2. Cursor phases: 22, 24, 25, 28, 26 (by loc), 15, 19, 21, 55–59, 71
 * 3. Full-snapshot tick (never partial graph): 43, 45, 8, 33, 27, 46–48
 * 4. Rollup + upsert — only then may the run become complete/partial
 *
 * A run stays `running` while post_crawl_phase is not `done`.
 */

import {
  buildInternalLinkGraph,
  inspectSiteSitemaps,
  hasNoindexDirective,
  extractHtmlCanonical,
  extractCanonicalDeclarations,
  inspectDocumentHead,
  normalizeFixStrategyUrl,
  isSitemapXmlDocument,
  type SitemapInspection,
  type InternalLinkGraph,
} from '@/lib/fix-strategies/shared'
import { detectTrailingSlashDuplicates, detectIndexHtmlDuplicates } from '@/lib/fix-strategies/topic-8'
import { resolveDuplicateUrlArtefactPath } from '@/lib/fix-strategies/duplicate-url'
import { detectCanonicalPointsToNoindexed } from '@/lib/fix-strategies/topic-15'
import { detectNoindexShouldIndex } from '@/lib/fix-strategies/topic-19'
import { detectBlockedRenderResources } from '@/lib/fix-strategies/topic-21'
import { detectRobotsTxtIssues } from '@/lib/fix-strategies/topic-22'
import { detectSitemapMissingOrUnreachable } from '@/lib/fix-strategies/topic-24'
import { detectSitemapXmlInvalid } from '@/lib/fix-strategies/topic-25'
import { detectSitemapNotIndexableLocs } from '@/lib/fix-strategies/topic-26'
import { detectIndexableUrlsAbsent } from '@/lib/fix-strategies/topic-27'
import { detectSitemapNotReferencedInRobots } from '@/lib/fix-strategies/topic-28'
import { detectDuplicateTitlesDescriptions } from '@/lib/fix-strategies/topic-33'
import { detectOrphanPages } from '@/lib/fix-strategies/topic-43'
import { detectCrawlDepth } from '@/lib/fix-strategies/topic-45'
import { detectMissingReturnLinks } from '@/lib/fix-strategies/topic-46'
import { detectInvalidLanguageRegionCodes } from '@/lib/fix-strategies/topic-47'
import { detectAlternateTargetNotIndexable } from '@/lib/fix-strategies/topic-48'
import { detectGoogleChosenCanonicalMismatch } from '@/lib/fix-strategies/topic-55'
import { detectDiscoveredNotIndexed } from '@/lib/fix-strategies/topic-56'
import { detectCrawledNotIndexed } from '@/lib/fix-strategies/topic-57'
import { detectIndexedVsCrawlMismatch } from '@/lib/fix-strategies/topic-58'
import { detectImpressionsNoInternalLinks } from '@/lib/fix-strategies/topic-59'
import { detectPaginationSeriesIssues } from '@/lib/fix-strategies/topic-71'
import { loadGscDetectContext } from '@/lib/fix-strategies/shared/gsc-detect-context'
import { normalizeCanonicalForGscMatch } from '@/lib/fix-strategies/shared/canonical-normalize'
import {
  isPaginatedUrl,
  paginationPatternUrlsFromCrawl,
} from '@/lib/fix-strategies/shared/pagination'
import { POST_CRAWL_TOPIC_IDS } from '@/lib/fix-strategies/detector-scope'
import {
  CRAWL_POST_CRAWL_DEADLINE_MS,
  CRAWL_TOPIC26_LOC_CHUNK,
  POST_CRAWL_PHASE_IDS,
  type CoverageNote,
  type CrawlRunRecord,
  type CrawlUrlJob,
  type PostCrawlCursor,
  type PostCrawlPhase,
  type PostCrawlPhaseId,
} from './constants'
import {
  deserializeLinkGraph,
  deserializeSitemapInspection,
  serializeLinkGraph,
  serializeSitemapInspection,
} from './post-crawl-serialize'
import {
  hopDepsFromFetch,
  makeGapFetchDeps,
  rollupAndClassify,
  takeBuckets,
  type DetectorEmit,
  type WholeSitePageInput,
  type WholeSiteDetectorOptions,
} from './run-detectors'
import type { FindingsStore } from './store'

export function nextPostCrawlPhase(
  current: PostCrawlPhase | null,
): PostCrawlPhase {
  if (current == null || current === 'done') return 'done'
  const idx = POST_CRAWL_PHASE_IDS.indexOf(current as PostCrawlPhaseId)
  if (idx < 0) return 'done'
  if (idx >= POST_CRAWL_PHASE_IDS.length - 1) return 'done'
  return POST_CRAWL_PHASE_IDS[idx + 1]!
}

export function isPostCrawlComplete(phase: PostCrawlPhase | null): boolean {
  return phase === 'done'
}

/** Build whole-site page inputs from terminal crawl jobs. */
export function wholeSitePagesFromJobs(
  jobs: CrawlUrlJob[],
): WholeSitePageInput[] {
  const sitemapUrls = new Set(jobs.map((j) => j.url.replace(/\/$/, '')))
  return jobs
    .filter(
      (j) =>
        (j.status === 'crawled' || j.status === 'client_only') &&
        (j.html != null || j.clientOnly),
    )
    .map((j) => ({
      url: j.finalUrl || j.url,
      html: j.html ?? '',
      status: j.httpStatus,
      clientOnly: j.clientOnly,
      inSitemap: sitemapUrls.has((j.finalUrl || j.url).replace(/\/$/, '')),
    }))
}

function usableHtmlPages(pages: WholeSitePageInput[]): WholeSitePageInput[] {
  return pages.filter(
    (p) =>
      !p.clientOnly &&
      p.html &&
      !isSitemapXmlDocument(p.html) &&
      p.status != null &&
      p.status >= 200 &&
      p.status < 400,
  )
}

function flattenTopic26Locs(
  inspection: SitemapInspection,
  origin: string,
): Array<{ loc: string; artefactPath: string }> {
  const out: Array<{ loc: string; artefactPath: string }> = []
  for (const doc of inspection.documents) {
    if (!doc.body || !doc.parsed || doc.parsed.kind !== 'urlset') continue
    for (const loc of doc.parsed.locs) {
      out.push({
        loc: normalizeFixStrategyUrl(loc, origin) ?? loc,
        artefactPath: doc.url,
      })
    }
  }
  return out
}

type PhaseCtx = {
  origin: string
  pages: WholeSitePageInput[]
  usableHtml: WholeSitePageInput[]
  siteId?: string | null
  inspection: SitemapInspection | null
  graph: InternalLinkGraph | null
  fetchDeps: ReturnType<typeof makeGapFetchDeps>
  deadlineAt: number
  cursor: PostCrawlCursor
  priorEmits: DetectorEmit[]
}

export type PostCrawlAdvanceResult = {
  phase: PostCrawlPhase
  cursor: PostCrawlCursor | null
  sitemapInspection: unknown | null
  linkGraph: unknown | null
  /** True when every phase including rollup finished this tick or earlier. */
  complete: boolean
  /** Yield before running full_snapshot when other work already ran this tick. */
  notes: CoverageNote[]
  /** Emits produced this tick (topic phases) — caller persists via replace/append. */
  topicEmits: Array<{ topicId: string; emits: DetectorEmit[]; mode: 'replace' | 'append' }>
  /** When true, caller should rollup+upsert all emits and may terminalise. */
  didRollup: boolean
  rolledFindings?: ReturnType<typeof rollupAndClassify>
}

/**
 * Advance one or more post-crawl phases within the soft deadline.
 * Caller persists phase/cursor/artifacts and topic emits.
 */
export async function advancePostCrawlPhases(
  input: {
    origin: string
    pages: WholeSitePageInput[]
    siteId?: string | null
    phase: PostCrawlPhase | null
    cursor: PostCrawlCursor | null
    sitemapInspection: unknown | null
    linkGraph: unknown | null
    /** Soft deadline epoch ms. */
    deadlineAt?: number
    /**
     * When true, this tick already did URL work — start cursor topics only if
     * time remains; never start full_snapshot mid-tick after other work.
     */
    sharedTickWithUrlWork?: boolean
    /** Prior run emits (for topic 57 independent-findings linkage). */
    priorEmits?: DetectorEmit[]
  },
): Promise<PostCrawlAdvanceResult> {
  const deadlineAt =
    input.deadlineAt ?? Date.now() + CRAWL_POST_CRAWL_DEADLINE_MS
  let phase: PostCrawlPhase =
    input.phase == null ? 'persist_inspection' : input.phase
  let cursor: PostCrawlCursor = { ...(input.cursor ?? {}) }
  let inspection = deserializeSitemapInspection(input.sitemapInspection)
  let graph = deserializeLinkGraph(input.linkGraph)
  let serializedInspection = input.sitemapInspection
  let serializedGraph = input.linkGraph
  const notes: CoverageNote[] = []
  const topicEmits: PostCrawlAdvanceResult['topicEmits'] = []
  let didWork = Boolean(input.sharedTickWithUrlWork)
  let didRollup = false
  let rolledFindings: ReturnType<typeof rollupAndClassify> | undefined

  if (phase === 'done') {
    return {
      phase: 'done',
      cursor: null,
      sitemapInspection: serializedInspection,
      linkGraph: serializedGraph,
      complete: true,
      notes,
      topicEmits,
      didRollup: false,
    }
  }

  const usableHtml = usableHtmlPages(input.pages)
  const fetchDeps = makeGapFetchDeps()

  const ctxBase = (): PhaseCtx => ({
    origin: input.origin,
    pages: input.pages,
    usableHtml,
    siteId: input.siteId,
    inspection,
    graph,
    fetchDeps,
    deadlineAt,
    cursor,
    priorEmits: input.priorEmits ?? [],
  })

  while (phase !== 'done' && Date.now() < deadlineAt) {
    // Full-snapshot must run on its own tick after graph is persisted —
    // never share a tick with URL work or cursor phases (chunked graphs
    // invented orphans once already).
    if (phase === 'full_snapshot' && didWork) {
      break
    }

    try {
      if (phase === 'persist_inspection') {
        inspection = await inspectSiteSitemaps({
          originUrl: input.origin,
          deps: fetchDeps,
        })
        serializedInspection = serializeSitemapInspection(inspection)
        phase = nextPostCrawlPhase(phase)
        cursor = {}
        didWork = true
        continue
      }

      if (phase === 'persist_graph') {
        const graphPages = input.pages
          .filter(
            (p) =>
              (p.html || p.clientOnly) &&
              !(p.html && isSitemapXmlDocument(p.html)),
          )
          .map((p) => ({
            url: p.url,
            html: p.clientOnly ? '' : p.html,
            status: p.status,
            inSitemap: p.inSitemap === true,
          }))
        graph = buildInternalLinkGraph({
          originUrl: input.origin,
          pages: graphPages,
        })
        serializedGraph = serializeLinkGraph(graph)
        phase = nextPostCrawlPhase(phase)
        cursor = {}
        didWork = true
        // Yield so cursor topics start cleanly on a fresh budget when
        // inspection+graph already consumed significant wall time.
        if (Date.now() >= deadlineAt - 5_000) break
        continue
      }

      if (phase === 'rollup') {
        // Caller performs list+rollup+upsert; we only signal.
        didRollup = true
        phase = 'done'
        cursor = {}
        didWork = true
        break
      }

      const result = await runDetectorPhase(phase, ctxBase())
      for (const te of result.topicEmits) topicEmits.push(te)
      cursor = result.cursor
      if (result.phaseComplete) {
        phase = nextPostCrawlPhase(phase)
        cursor = {}
      }
      didWork = true

      // After finishing the last cursor phase, yield so full_snapshot is alone.
      if (phase === 'full_snapshot') break
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      notes.push({
        code: 'fetch_failure',
        detail: `post-crawl phase ${phase} failed: ${detail}`,
      })
      // Skip failed phase so the run can still reach rollup (honest partial).
      phase = nextPostCrawlPhase(phase)
      cursor = {}
      didWork = true
    }
  }

  return {
    phase,
    cursor: phase === 'done' ? null : Object.keys(cursor).length ? cursor : null,
    sitemapInspection: serializedInspection,
    linkGraph: serializedGraph,
    complete: phase === 'done',
    notes,
    topicEmits,
    didRollup,
    rolledFindings,
  }
}

type DetectorPhaseResult = {
  topicEmits: PostCrawlAdvanceResult['topicEmits']
  cursor: PostCrawlCursor
  phaseComplete: boolean
}

async function runDetectorPhase(
  phase: PostCrawlPhase,
  ctx: PhaseCtx,
): Promise<DetectorPhaseResult> {
  const topicEmits: PostCrawlAdvanceResult['topicEmits'] = []
  const empty = (): DetectorPhaseResult => ({
    topicEmits,
    cursor: ctx.cursor,
    phaseComplete: true,
  })

  if (phase === 'topic_22') {
    const out: DetectorEmit[] = []
    takeBuckets(
      '22',
      'robots/invalid-or-unreachable',
      await detectRobotsTxtIssues({
        originUrl: ctx.origin,
        deps: hopDepsFromFetch(ctx.fetchDeps),
        inspection: ctx.inspection?.robots,
      }),
      out,
      `${ctx.origin}/robots.txt`,
    )
    topicEmits.push({ topicId: '22', emits: out, mode: 'replace' })
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  if (phase === 'topic_24') {
    const out: DetectorEmit[] = []
    if (ctx.inspection) {
      takeBuckets(
        '24',
        'sitemap/missing-or-unreachable',
        detectSitemapMissingOrUnreachable({ inspection: ctx.inspection }),
        out,
        `${ctx.origin}/sitemap.xml`,
      )
    }
    topicEmits.push({ topicId: '24', emits: out, mode: 'replace' })
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  if (phase === 'topic_25') {
    const out: DetectorEmit[] = []
    if (ctx.inspection) {
      takeBuckets(
        '25',
        'sitemap/xml-invalid',
        detectSitemapXmlInvalid({ inspection: ctx.inspection }),
        out,
        `${ctx.origin}/sitemap.xml`,
      )
    }
    topicEmits.push({ topicId: '25', emits: out, mode: 'replace' })
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  if (phase === 'topic_28') {
    const out: DetectorEmit[] = []
    if (ctx.inspection) {
      takeBuckets(
        '28',
        'sitemap/not-referenced-in-robots',
        detectSitemapNotReferencedInRobots({ inspection: ctx.inspection }),
        out,
        `${ctx.origin}/robots.txt`,
      )
    }
    topicEmits.push({ topicId: '28', emits: out, mode: 'replace' })
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  if (phase === 'topic_26') {
    return runTopic26Chunk(ctx)
  }

  if (phase === 'topic_15') {
    return runTopic15Chunk(ctx)
  }

  if (phase === 'topic_19') {
    const out: DetectorEmit[] = []
    if (ctx.usableHtml.length > 0) {
      const sitemapLocs = ctx.inspection?.allLocsNormalized ?? new Set<string>()
      takeBuckets(
        '19',
        'indexability/noindex-should-index',
        detectNoindexShouldIndex(
          ctx.usableHtml.map((p) => {
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
    topicEmits.push({ topicId: '19', emits: out, mode: 'replace' })
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  if (phase === 'topic_21') {
    const out: DetectorEmit[] = []
    if (ctx.usableHtml.length > 0) {
      takeBuckets(
        '21',
        'robots/blocked-render-resources',
        detectBlockedRenderResources(
          ctx.usableHtml.map((p) => ({
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
          ctx.inspection?.robots ?? null,
        ),
        out,
      )
    }
    topicEmits.push({ topicId: '21', emits: out, mode: 'replace' })
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  if (phase === 'topic_55_59') {
    const out = await runGscTopics(ctx)
    for (const id of ['55', '56', '57', '58', '59'] as const) {
      topicEmits.push({
        topicId: id,
        emits: out.filter((e) => e.topicId === id),
        mode: 'replace',
      })
    }
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  if (phase === 'topic_71') {
    const out: DetectorEmit[] = []
    takeBuckets(
      '71',
      'pagination/series-misconfigured',
      detectPaginationSeriesIssues({
        pages: ctx.usableHtml.map((p) => ({
          url: p.url,
          html: p.html,
          status: p.status,
        })),
      }),
      out,
    )
    topicEmits.push({ topicId: '71', emits: out, mode: 'replace' })
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  if (phase === 'full_snapshot') {
    return runFullSnapshotPhase(ctx)
  }

  return empty()
}

async function runTopic26Chunk(ctx: PhaseCtx): Promise<DetectorPhaseResult> {
  const topicEmits: PostCrawlAdvanceResult['topicEmits'] = []
  const out: DetectorEmit[] = []
  if (!ctx.inspection) {
    topicEmits.push({ topicId: '26', emits: out, mode: 'replace' })
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  const locs = flattenTopic26Locs(ctx.inspection, ctx.origin)
  let locIndex = ctx.cursor.locIndex ?? 0
  if (locIndex === 0) {
    // First chunk — clear prior topic-26 emits via replace of empty then append.
    topicEmits.push({ topicId: '26', emits: [], mode: 'replace' })
  }

  const start = locIndex
  let processed = 0
  while (locIndex < locs.length && Date.now() < ctx.deadlineAt) {
    // Soft floor: process a small batch even near deadline; stop when budget gone.
    if (processed >= CRAWL_TOPIC26_LOC_CHUNK && Date.now() >= ctx.deadlineAt - 2_000) {
      break
    }
    const batchEnd = Math.min(locIndex + 1, locs.length)
    const item = locs[locIndex]!
    const detected = await detectSitemapNotIndexableLocs(
      [item.loc],
      {
        artefactPath: item.artefactPath,
        isGenerated: true,
        generatorPath: null,
        appDir: 'app',
        siteOrigin: ctx.origin,
      },
      ctx.fetchDeps,
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
      item.artefactPath,
    )
    locIndex = batchEnd
    processed++
    void start
  }

  topicEmits.push({ topicId: '26', emits: out, mode: 'append' })
  const phaseComplete = locIndex >= locs.length
  return {
    topicEmits,
    cursor: phaseComplete ? {} : { locIndex },
    phaseComplete,
  }
}

async function runTopic15Chunk(ctx: PhaseCtx): Promise<DetectorPhaseResult> {
  const topicEmits: PostCrawlAdvanceResult['topicEmits'] = []
  const out: DetectorEmit[] = []
  const crawlByNorm = new Map<string, WholeSitePageInput>()
  for (const p of ctx.pages) {
    const norm = normalizeFixStrategyUrl(p.url) ?? p.url.replace(/\/$/, '')
    crawlByNorm.set(norm, p)
    crawlByNorm.set(p.url, p)
    crawlByNorm.set(p.url.replace(/\/$/, ''), p)
  }

  let pageIndex = ctx.cursor.pageIndex ?? 0
  if (pageIndex === 0) {
    topicEmits.push({ topicId: '15', emits: [], mode: 'replace' })
  }

  while (pageIndex < ctx.usableHtml.length && Date.now() < ctx.deadlineAt) {
    const p = ctx.usableHtml[pageIndex]!
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
    pageIndex++
  }

  topicEmits.push({ topicId: '15', emits: out, mode: 'append' })
  const phaseComplete = pageIndex >= ctx.usableHtml.length
  return {
    topicEmits,
    cursor: phaseComplete ? {} : { pageIndex },
    phaseComplete,
  }
}

async function runGscTopics(ctx: PhaseCtx): Promise<DetectorEmit[]> {
  const out: DetectorEmit[] = []
  if (!ctx.graph) return out
  const gsc = await loadGscDetectContext(ctx.siteId ?? null)
  if (!gsc) return out

  const orphanNormalized = new Set<string>()
  for (const n of ctx.graph.nodes) {
    if (n.urlNormalized === ctx.graph.homepageNormalized) continue
    const inbound = ctx.graph.edges.filter(
      (e) => e.crawlable && e.toNormalized === n.urlNormalized,
    )
    if (inbound.length === 0) orphanNormalized.add(n.urlNormalized)
  }

  const crawledNormalized = new Set<string>()
  const declaredCanonicalByUrl = new Map<string, string | null>()
  for (const p of ctx.pages) {
    const norm =
      normalizeCanonicalForGscMatch(p.url) ||
      normalizeFixStrategyUrl(p.url) ||
      p.url
    const sitemapDoc = Boolean(p.html && isSitemapXmlDocument(p.html))
    if (
      p.status != null &&
      p.status >= 200 &&
      p.status < 400 &&
      !p.clientOnly &&
      !sitemapDoc
    ) {
      crawledNormalized.add(norm)
    }
    if (p.html && !sitemapDoc) {
      const canon = extractHtmlCanonical(p.html, p.url, 'text/html')
      declaredCanonicalByUrl.set(
        norm,
        canon ? normalizeCanonicalForGscMatch(canon) : null,
      )
    }
  }

  const onlyNoncrawlableNormalized = new Set<string>()
  for (const e of ctx.graph.edges) {
    if (!e.crawlable && e.toNormalized) {
      const hasCrawlable = ctx.graph.edges.some(
        (x) => x.crawlable && x.toNormalized === e.toNormalized,
      )
      if (!hasCrawlable) onlyNoncrawlableNormalized.add(e.toNormalized)
    }
  }

  takeBuckets(
    '55',
    'gsc/google-chosen-canonical-mismatch',
    detectGoogleChosenCanonicalMismatch({ gsc, declaredCanonicalByUrl }),
    out,
  )
  takeBuckets(
    '56',
    'gsc/discovered-not-indexed',
    detectDiscoveredNotIndexed({ gsc, orphanNormalized }),
    out,
  )
  const independentFindingsByUrl = new Map<string, string[]>()
  for (const e of [...ctx.priorEmits, ...out]) {
    if (e.bucket === 'internal') continue
    if (!e.pageUrl || !e.verdict) continue
    const norm =
      normalizeCanonicalForGscMatch(e.pageUrl) ||
      normalizeFixStrategyUrl(e.pageUrl) ||
      e.pageUrl
    const label = `topic-${e.topicId}: ${e.verdict}`
    const prev = independentFindingsByUrl.get(norm) || []
    if (!prev.includes(label)) prev.push(label)
    independentFindingsByUrl.set(norm, prev)
  }
  takeBuckets(
    '57',
    'gsc/crawled-not-indexed',
    detectCrawledNotIndexed({ gsc, independentFindingsByUrl }),
    out,
  )
  takeBuckets(
    '58',
    'gsc/indexed-vs-crawl-mismatch',
    detectIndexedVsCrawlMismatch({
      gsc,
      crawledNormalized,
      orphanNormalized,
    }),
    out,
  )
  takeBuckets(
    '59',
    'gsc/impressions-no-internal-links',
    detectImpressionsNoInternalLinks({
      gsc,
      orphanNormalized,
      onlyNoncrawlableNormalized,
    }),
    out,
  )
  return out
}

async function runFullSnapshotPhase(
  ctx: PhaseCtx,
): Promise<DetectorPhaseResult> {
  const topicEmits: PostCrawlAdvanceResult['topicEmits'] = []
  const graph = ctx.graph
  const inspection = ctx.inspection
  if (!graph) {
    // Graph must be persisted before this phase — treat as empty snapshot.
    for (const id of ['43', '45', '8', '33', '27', '46', '47', '48']) {
      topicEmits.push({ topicId: id, emits: [], mode: 'replace' })
    }
    return { topicEmits, cursor: {}, phaseComplete: true }
  }

  const inboundLinked = new Set(
    graph.edges.filter((e) => e.crawlable).map((e) => e.toNormalized),
  )
  if (graph.homepageNormalized) inboundLinked.add(graph.homepageNormalized)

  const discoveredNormalized = new Set<string>()
  const addDiscovered = (u: string | null | undefined) => {
    if (!u) return
    const n = normalizeFixStrategyUrl(u)
    if (n) discoveredNormalized.add(n)
  }
  for (const p of ctx.pages) addDiscovered(p.url)
  if (inspection) {
    for (const loc of inspection.allLocsNormalized) discoveredNormalized.add(loc)
  }
  for (const e of graph.edges) {
    addDiscovered(e.fromNormalized)
    addDiscovered(e.toNormalized)
  }

  // Topic 8
  {
    const out: DetectorEmit[] = []
    if (ctx.usableHtml.length > 0) {
      const hopDeps = hopDepsFromFetch(ctx.fetchDeps)
      const dupPages = ctx.usableHtml.map((p) => ({ url: p.url, body: p.html }))
      const sitemapUrls = inspection
        ? Array.from(inspection.allLocsNormalized)
        : []
      const internalLinkUrls = Array.from(inboundLinked)
      const signals = { sitemapUrls, internalLinkUrls }
      const htmlSamples = ctx.usableHtml.map((p) => p.html).slice(0, 5)
      const artefactPath = resolveDuplicateUrlArtefactPath({ htmlSamples })
      takeBuckets(
        '8',
        'duplicate-url/trailing-slash',
        await detectTrailingSlashDuplicates(dupPages, {
          deps: hopDeps,
          discoveredNormalized,
          signals,
          artefactPath,
          htmlSamples,
        }),
        out,
      )
      takeBuckets(
        '8',
        'duplicate-url/index-html',
        await detectIndexHtmlDuplicates(dupPages, {
          deps: hopDeps,
          discoveredNormalized,
          signals,
          artefactPath,
          htmlSamples,
        }),
        out,
      )
    }
    topicEmits.push({ topicId: '8', emits: out, mode: 'replace' })
  }

  // Topic 27
  {
    const out: DetectorEmit[] = []
    if (inspection) {
      takeBuckets(
        '27',
        'sitemap/indexable-urls-absent',
        detectIndexableUrlsAbsent({
          inspection,
          pages: ctx.usableHtml.map((p) => {
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
              parameterised: isPaginatedUrl(p.url),
            }
          }),
        }),
        out,
        `${ctx.origin}/sitemap.xml`,
      )
    }
    topicEmits.push({ topicId: '27', emits: out, mode: 'replace' })
  }

  // Topic 33
  {
    const out: DetectorEmit[] = []
    if (ctx.usableHtml.length >= 2) {
      const topic33Pages = ctx.usableHtml.map((p) => {
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
          paginated: isPaginatedUrl(p.url),
        }
      })
      takeBuckets(
        '33',
        'head/duplicate-titles-descriptions',
        detectDuplicateTitlesDescriptions({ pages: topic33Pages }),
        out,
      )
    }
    topicEmits.push({ topicId: '33', emits: out, mode: 'replace' })
  }

  // Topic 43
  {
    const out: DetectorEmit[] = []
    const hasClientOnlyPages = ctx.pages.some((p) => p.clientOnly)
    takeBuckets(
      '43',
      'internal-links/orphan-pages',
      detectOrphanPages({ graph, hasClientOnlyPages }),
      out,
    )
    topicEmits.push({ topicId: '43', emits: out, mode: 'replace' })
  }

  // Topic 45
  {
    const out: DetectorEmit[] = []
    takeBuckets(
      '45',
      'internal-links/crawl-depth',
      detectCrawlDepth({
        graph,
        paginationPatternUrls: paginationPatternUrlsFromCrawl(
          ctx.pages.map((p) => p.url),
        ),
      }),
      out,
    )
    topicEmits.push({ topicId: '45', emits: out, mode: 'replace' })
  }

  // Topics 46/47/48
  {
    const out46: DetectorEmit[] = []
    const out47: DetectorEmit[] = []
    const out48: DetectorEmit[] = []
    if (ctx.usableHtml.length > 0) {
      const hreflangCollect = {
        originUrl: ctx.origin,
        pages: ctx.usableHtml.map((p) => ({
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
        out46,
      )
      takeBuckets(
        '47',
        'hreflang/invalid-language-region-codes',
        detectInvalidLanguageRegionCodes({ collect: hreflangCollect }),
        out47,
      )
      takeBuckets(
        '48',
        'hreflang/alternate-target-not-indexable',
        detectAlternateTargetNotIndexable({ collect: hreflangCollect }),
        out48,
      )
    }
    topicEmits.push({ topicId: '46', emits: out46, mode: 'replace' })
    topicEmits.push({ topicId: '47', emits: out47, mode: 'replace' })
    topicEmits.push({ topicId: '48', emits: out48, mode: 'replace' })
  }

  return { topicEmits, cursor: {}, phaseComplete: true }
}

/**
 * Single-shot compat for tests / callers that still expect all whole-site
 * emits in one invocation. Prefer advancePostCrawlPhases in the orchestrator.
 */
export async function collectAllPostCrawlEmits(
  origin: string,
  pages: WholeSitePageInput[],
  options?: WholeSiteDetectorOptions,
): Promise<DetectorEmit[]> {
  if (pages.length === 0) return []

  let phase: PostCrawlPhase | null = null
  let cursor: PostCrawlCursor | null = null
  let sitemapInspection: unknown | null = null
  let linkGraph: unknown | null = null
  const byTopic = new Map<string, DetectorEmit[]>()

  // Generous deadline — single-shot callers (tests) are not under Vercel.
  const deadlineAt = Date.now() + 30 * 60_000
  let guard = 0
  while (guard++ < 500) {
    const adv = await advancePostCrawlPhases({
      origin,
      pages,
      siteId: options?.siteId,
      phase,
      cursor,
      sitemapInspection,
      linkGraph,
      deadlineAt,
    })
    for (const te of adv.topicEmits) {
      if (te.mode === 'replace') {
        byTopic.set(te.topicId, [...te.emits])
      } else {
        const prev = byTopic.get(te.topicId) ?? []
        byTopic.set(te.topicId, [...prev, ...te.emits])
      }
    }
    phase = adv.phase
    cursor = adv.cursor
    sitemapInspection = adv.sitemapInspection
    linkGraph = adv.linkGraph
    if (adv.complete || adv.didRollup || phase === 'done' || phase === 'rollup') {
      // Drain rollup signal without needing a store — just finish detector phases.
      if (phase === 'rollup') {
        phase = 'done'
      }
      break
    }
  }

  const out: DetectorEmit[] = []
  for (const id of POST_CRAWL_TOPIC_IDS) {
    const emits = byTopic.get(id)
    if (emits) out.push(...emits)
  }
  // Include any unexpected topic ids
  for (const [id, emits] of byTopic) {
    if (!(POST_CRAWL_TOPIC_IDS as readonly string[]).includes(id)) {
      out.push(...emits)
    }
  }
  return out
}

/**
 * Persist topic emits from a post-crawl advance onto the run.
 */
export async function persistPostCrawlTopicEmits(
  store: FindingsStore,
  runId: string,
  topicEmits: PostCrawlAdvanceResult['topicEmits'],
): Promise<void> {
  for (const te of topicEmits) {
    if (te.mode === 'replace') {
      await store.replaceRunEmitsForTopic(runId, te.topicId, te.emits)
    } else if (te.emits.length > 0) {
      await store.appendRunEmits(runId, te.emits)
    }
  }
}

export type ApplyPostCrawlTickInput = {
  store: FindingsStore
  run: CrawlRunRecord
  pages: WholeSitePageInput[]
  sharedTickWithUrlWork?: boolean
  deadlineAt?: number
}

/**
 * Run post-crawl advance + persist phase state and topic emits.
 * Does NOT mark the run complete — caller decides status after `complete`.
 * When `didRollup`, caller must rollup+upsert before terminalising.
 */
export async function applyPostCrawlTick(
  input: ApplyPostCrawlTickInput,
): Promise<PostCrawlAdvanceResult> {
  const { store, run, pages } = input
  const priorEmits = await store.listRunEmits(run.id)
  const adv = await advancePostCrawlPhases({
    origin: run.origin,
    pages,
    siteId: run.siteId,
    phase: run.postCrawlPhase,
    cursor: run.postCrawlCursor,
    sitemapInspection: run.sitemapInspection,
    linkGraph: run.linkGraph,
    deadlineAt: input.deadlineAt,
    sharedTickWithUrlWork: input.sharedTickWithUrlWork,
    priorEmits,
  })

  await persistPostCrawlTopicEmits(store, run.id, adv.topicEmits)

  await store.updateRun(run.id, {
    postCrawlPhase: adv.phase,
    postCrawlCursor: adv.cursor,
    sitemapInspection: adv.sitemapInspection,
    linkGraph: adv.linkGraph,
  })

  return adv
}
