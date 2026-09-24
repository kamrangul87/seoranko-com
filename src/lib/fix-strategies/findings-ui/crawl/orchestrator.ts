/**
 * Chunked crawl orchestrator for Findings UI.
 *
 * Chunk size = CRAWL_URL_CHUNK_SIZE (5). Why: each URL does stream-complete
 * fetch + topic-68 re-fetch + multi-detector work (incl. image probes). Five
 * URLs fit a ~45s tick under Vercel Hobby maxDuration=60 with backoff headroom;
 * remaining URLs resume on the next /tick.
 *
 * Status:
 * - complete = frontier exhausted (no cap), queue empty, no coverage gaps
 * - partial = discovery/maxUrls cap, or client_only / fetch failures / backoff
 *   / stream_incomplete after the queue drains (or permanently stopped with
 *   work left). Mid-tick time_limit with URLs still queued → stays running.
 */

import {
  CRAWL_MAX_DISCOVERED,
  CRAWL_TICK_DEADLINE_MS,
  CRAWL_URL_CHUNK_SIZE,
  type CoverageNote,
} from './constants'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import { discoverSameHostUrls, extractSameHostLinks } from './discover'
import { crawlOneUrl, type CrawledPage } from './fetch-page'
import {
  runDetectorsOnPages,
  runWholeSiteDetectorsOnCrawl,
  rollupAndClassify,
  type PriorFiveXXObservation,
} from './run-detectors'
import { POST_CRAWL_TOPIC_IDS } from '@/lib/fix-strategies/detector-scope'
import { getFindingsStore, type FindingsStore } from './store'
import { isSafePublicUrl } from '@/lib/fetch-page-content'
import {
  isDisallowedByRobots,
  parseRobotsForCrawler,
  type RobotsRules,
} from './crawler-identity'
import { safeCrawlFetch } from './safe-crawl-fetch'
import { buildRawRenderMismatch } from '@/lib/crawl-render/raw-render-mismatch'

export type StartCrawlInput = {
  /** Connected site id, or null for detection-only. */
  siteId: string | null
  userId: string
  origin: string
  /** Public URL, no connected_sites row, no repo credentials. */
  detectOnly?: boolean
  store?: FindingsStore
  /**
   * Optional extra enqueue cap (tests / plan page limit). Hitting this
   * (or CRAWL_MAX_DISCOVERED) marks the run partial — never complete.
   */
  maxUrls?: number
  /**
   * When set with maxUrls, emit an explicit plan_page_limit coverage note
   * naming the plan (never silent truncation).
   */
  planPageLimit?: {
    planLabel: string
  }
}

export type TickResult = {
  runId: string
  status: string
  processedThisTick: number
  remainingQueued: number
  isPartial: boolean
  coverageNotes: CoverageNote[]
  done: boolean
}

/**
 * Topic 3's persistent-5xx window needs a real prior observation, not just
 * the current run's own re-fetch pair (which is only ever seconds apart).
 * Looks up the single most recent OTHER run in this same scope and returns
 * its 5xx-status URLs, keyed by finalUrl — best-effort: no prior run, or a
 * lookup failure, just means persistent-5xx can't fire yet for this run
 * (same as before this existed), not a crawl failure.
 */
export async function buildPriorFiveXXByUrl(
  store: FindingsStore,
  run: { id: string; siteId: string | null; detectOrigin: string | null; userId: string },
): Promise<Map<string, PriorFiveXXObservation>> {
  const byUrl = new Map<string, PriorFiveXXObservation>()
  try {
    const priorRuns = run.siteId
      ? await store.listRunsForSite(run.siteId)
      : run.detectOrigin
        ? await store.listRunsForDetectOrigin(run.userId, run.detectOrigin)
        : []
    const priorRun = priorRuns.find((r) => r.id !== run.id)
    if (!priorRun) return byUrl

    const jobs = await store.listJobsForRun(priorRun.id)
    for (const job of jobs) {
      if (job.httpStatus == null || job.httpStatus < 500 || job.httpStatus >= 600) continue
      if (!job.processedAt) continue
      const key = job.finalUrl ?? job.url
      const observedAtMs = Date.parse(job.processedAt)
      if (Number.isNaN(observedAtMs)) continue
      const existing = byUrl.get(key)
      if (!existing || observedAtMs > existing.observedAtMs) {
        byUrl.set(key, { status: job.httpStatus, observedAtMs })
      }
    }
  } catch (err) {
    console.warn('[orchestrator] buildPriorFiveXXByUrl failed (non-fatal):', err)
  }
  return byUrl
}

export async function startCrawlRun(
  input: StartCrawlInput,
): Promise<{ runId: string; urlsDiscovered: number; urlsFound: number }> {
  const store = input.store ?? getFindingsStore()
  const originNorm = input.origin.replace(/\/$/, '')
  const run = await store.createRun({
    siteId: input.detectOnly ? null : input.siteId,
    userId: input.userId,
    origin: originNorm,
    detectOnly: input.detectOnly === true,
  })

  const discovered = await discoverSameHostUrls(run.origin)
  let urls = discovered.urls
  const foundTotal = discovered.foundTotal
  const notes: CoverageNote[] = []

  for (const detail of discovered.notes) {
    if (/capped at/i.test(detail)) {
      notes.push({ code: 'discovery_cap', detail })
    } else if (/fetch failed|fallback/i.test(detail)) {
      notes.push({ code: 'fetch_failure', detail })
    } else {
      notes.push({ code: 'discovery_cap', detail })
    }
  }

  let urlCap: number | null = null
  let capped = discovered.capped

  if (input.maxUrls != null && urls.length > input.maxUrls) {
    urls = urls.slice(0, input.maxUrls)
    capped = true
    urlCap = input.maxUrls
    if (input.planPageLimit?.planLabel) {
      notes.push({
        code: 'plan_page_limit',
        detail: `${input.maxUrls} of ${foundTotal} pages crawled — ${input.planPageLimit.planLabel} plan limit`,
      })
    } else {
      notes.push({
        code: 'discovery_cap',
        detail: `enqueue capped at maxUrls=${input.maxUrls}: found ${foundTotal} same-host URLs, enqueued ${urls.length}, ${foundTotal - urls.length} not crawled`,
      })
    }
  } else if (input.maxUrls != null) {
    // Plan limit recorded even when the site is smaller than the cap —
    // urlCap documents the entitlement applied for this run.
    urlCap = input.maxUrls
    if (discovered.capped) {
      // Safety discovery cap still applied underneath the plan limit.
      urlCap = Math.min(input.maxUrls, CRAWL_MAX_DISCOVERED)
    }
  } else if (discovered.capped) {
    urlCap = CRAWL_MAX_DISCOVERED
  }

  if (discovered.skippedOffHost > 0) {
    notes.push({
      code: 'off_host',
      detail: `Skipped ${discovered.skippedOffHost} off-host sitemap loc(s)`,
    })
  }
  if (discovered.skippedRobots > 0) {
    notes.push({
      code: 'discovery_cap',
      detail: `Skipped ${discovered.skippedRobots} URL(s) disallowed by robots.txt for SEORANKO crawler`,
    })
  }

  notes.push({
    code: 'link_graph_expand',
    detail: `Seed discovery: robots Sitemap locs=${discovered.seeds.fromRobotsSitemaps}, sitemap fallback=${discovered.seeds.fromSitemapFallback}, homepage=${discovered.seeds.fromHomepage}; link-graph expansion during ticks`,
  })

  await store.enqueueUrls(run.id, urls)
  await store.updateRun(run.id, {
    status: 'queued',
    urlsFound: foundTotal,
    urlsDiscovered: urls.length,
    urlsSkippedOffHost: discovered.skippedOffHost,
    urlCap,
    discoverySeeds: discovered.seeds,
    coverageNotes: dedupeNotes(notes),
    // Cap means frontier not exhausted → never complete.
    isPartial: capped,
  })

  // Keep robots rules for this run in-process for tick politeness.
  rememberRobotsRules(run.id, discovered.robotsRules)

  return { runId: run.id, urlsDiscovered: urls.length, urlsFound: foundTotal }
}

const robotsByRun = new Map<string, RobotsRules>()

function rememberRobotsRules(runId: string, rules: RobotsRules) {
  robotsByRun.set(runId, rules)
}

async function robotsForRun(runId: string, origin: string): Promise<RobotsRules> {
  const cached = robotsByRun.get(runId)
  if (cached) return cached
  const robotsUrl = `${origin.replace(/\/$/, '')}/robots.txt`
  if (!isSafePublicUrl(robotsUrl)) return { disallows: [], allows: [] }
  const res = await safeCrawlFetch(robotsUrl)
  const rules = res.ok
    ? parseRobotsForCrawler(res.text)
    : { disallows: [], allows: [] }
  robotsByRun.set(runId, rules)
  return rules
}

export async function processCrawlTick(
  runId: string,
  opts?: {
    store?: FindingsStore
    chunkSize?: number
    deadlineMs?: number
  },
): Promise<TickResult> {
  const store = opts?.store ?? getFindingsStore()
  const chunkSize = opts?.chunkSize ?? CRAWL_URL_CHUNK_SIZE
  const deadline =
    Date.now() + (opts?.deadlineMs ?? CRAWL_TICK_DEADLINE_MS)

  let run = await store.getRun(runId)
  if (!run) throw new Error(`run not found: ${runId}`)

  if (run.status === 'complete' || run.status === 'failed' || run.status === 'partial') {
    const counts = await store.countJobsByStatus(runId)
    return {
      runId,
      status: run.status,
      processedThisTick: 0,
      remainingQueued: counts.queued,
      isPartial: run.isPartial || run.status === 'partial',
      coverageNotes: run.coverageNotes,
      done: true,
    }
  }

  run = await store.updateRun(runId, {
    status: 'running',
    startedAt: run.startedAt ?? new Date().toISOString(),
  })

  // Shrink claim size when this run already paid render cost — keeps the
  // tick inside deadline when headless work is expected.
  const knownRenderHeavy =
    (run.pagesRendered ?? 0) + (run.pagesRenderFailed ?? 0) > 0
  const renderChunk = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderChunkSize
  const renderMaxPerTick = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderMaxPerTick
  const adaptiveChunk = knownRenderHeavy
    ? Math.min(chunkSize, renderChunk)
    : chunkSize

  const jobs = await store.claimUrlChunk(runId, adaptiveChunk)
  const crawled: CrawledPage[] = []
  const notes: CoverageNote[] = [...run.coverageNotes]
  let crawledN = run.urlsCrawled
  let failedN = run.urlsFailed
  let clientOnlyN = run.urlsClientOnly
  let pagesRenderedN = run.pagesRendered
  let pagesRenderFailedN = run.pagesRenderFailed
  let totalRenderTimeMsN = run.totalRenderTimeMs ?? 0
  let rendersThisTick = 0
  let urlsDiscovered = run.urlsDiscovered
  let urlsFound = run.urlsFound
  let linkGraphAdded = run.discoverySeeds?.fromLinkGraph ?? 0
  const seedsBase = run.discoverySeeds ?? {
    fromRobotsSitemaps: 0,
    fromSitemapFallback: 0,
    fromHomepage: 0,
    fromLinkGraph: 0,
  }

  const robotsRules = await robotsForRun(runId, run.origin)

  for (const job of jobs) {
    if (Date.now() > deadline) {
      // Re-queue unprocessed claimed jobs
      await store.updateUrlJob(job.id, { status: 'queued' })
      notes.push({
        code: 'time_limit',
        detail: 'Tick deadline reached — run will resume on next tick',
        url: job.url,
      })
      continue
    }

    try {
      const allowRender = rendersThisTick < renderMaxPerTick
      const page = await crawlOneUrl(job.url, {
        robotsRules,
        skipRender: !allowRender,
      })

      // Render needed but tick budget exhausted → re-queue (not render_failed).
      if (
        !allowRender &&
        page.renderEvidence?.renderNeeded &&
        page.renderEvidence.renderError === 'skip_render'
      ) {
        await store.updateUrlJob(job.id, {
          status: 'queued',
          html: null,
          renderMode: null,
          rawHtmlHash: null,
          renderedHtmlHash: null,
          errorDetail: null,
        })
        notes.push({
          code: 'render_deferred',
          detail: `Render deferred — tick render budget (${renderMaxPerTick}) reached; URL re-queued`,
          url: job.url,
        })
        continue
      }
      if (
        page.errorDetail === 'robots_disallow' ||
        page.errorDetail === 'blocked_unsafe_url'
      ) {
        failedN++
        await store.updateUrlJob(job.id, {
          status: 'failed',
          httpStatus: page.status,
          finalUrl: page.finalUrl,
          streamComplete: false,
          errorDetail: page.errorDetail,
        })
        notes.push({
          code: page.errorDetail === 'robots_disallow' ? 'discovery_cap' : 'fetch_failure',
          detail:
            page.errorDetail === 'robots_disallow'
              ? 'Skipped — Disallow in robots.txt for SEORANKO crawler'
              : 'Skipped — URL refused by isSafePublicUrl',
          url: job.url,
        })
        continue
      }
      if (page.crawlerCausedBackoff) {
        failedN++
        await store.updateUrlJob(job.id, {
          status: 'failed',
          httpStatus: page.status,
          finalUrl: page.finalUrl,
          streamComplete: page.streamComplete,
          crawlerCausedBackoff: true,
          errorDetail: page.errorDetail,
        })
        notes.push({
          code: 'crawler_backoff',
          detail:
            'SEORANKO crawl triggered 429/5xx — backed off; not raised as a site finding (topic 3 guard 5)',
          url: job.url,
        })
        continue
      }

      if (!page.streamComplete || page.errorDetail === 'stream_incomplete') {
        failedN++
        await store.updateUrlJob(job.id, {
          status: 'failed',
          httpStatus: page.status,
          finalUrl: page.finalUrl,
          streamComplete: false,
          errorDetail: 'stream_incomplete',
        })
        notes.push({
          code: 'stream_incomplete',
          detail: 'Response stream incomplete — detectors refused (topic 67)',
          url: job.url,
        })
        continue
      }

      if (page.clientOnly) {
        clientOnlyN++
        await store.updateUrlJob(job.id, {
          status: 'client_only',
          httpStatus: page.status,
          finalUrl: page.finalUrl,
          streamComplete: true,
          clientOnly: true,
          html: page.html || page.rawHtml || '',
          renderMode: page.renderMode,
          rawHtmlHash: page.rawHtmlHash,
          renderedHtmlHash: page.renderedHtmlHash,
          errorDetail: page.errorDetail,
        })
        notes.push({
          code:
            page.renderMode === 'render_failed' ? 'render_failed' : 'client_only',
          detail:
            page.renderMode === 'render_failed'
              ? `render_needed but headless render failed (${page.renderEvidence?.renderError || 'unknown'}) — no headline verdict for this URL`
              : 'Served HTML looks client_only and render did not produce a DOM — content detectors skipped',
          url: job.url,
        })
        if (page.renderMode === 'render_failed') {
          pagesRenderFailedN++
          rendersThisTick++
          totalRenderTimeMsN += page.renderEvidence?.renderTookMs ?? 0
        }
        continue
      }

      if (page.status == null || page.status >= 400) {
        failedN++
        await store.updateUrlJob(job.id, {
          status: 'failed',
          httpStatus: page.status,
          finalUrl: page.finalUrl,
          streamComplete: page.streamComplete,
          errorDetail: page.errorDetail ?? `http_${page.status}`,
        })
        notes.push({
          code: 'fetch_failure',
          detail: page.errorDetail ?? `HTTP ${page.status}`,
          url: job.url,
        })
        continue
      }

      crawledN++
      if (page.renderMode === 'rendered') {
        pagesRenderedN++
        rendersThisTick++
        totalRenderTimeMsN += page.renderEvidence?.renderTookMs ?? 0
        notes.push({
          code: 'rendered',
          detail: `Headless render succeeded for ${page.finalUrl} in ${page.renderEvidence?.renderTookMs ?? 0}ms (reasons: ${(page.renderEvidence?.renderNeededReasons || []).join(',') || 'n/a'})`,
          url: page.finalUrl,
        })
      } else if (page.renderMode === 'render_failed' && page.renderEvidence?.renderNeeded) {
        pagesRenderFailedN++
        rendersThisTick++
        totalRenderTimeMsN += page.renderEvidence?.renderTookMs ?? 0
        notes.push({
          code: 'render_failed',
          detail: `render_needed but headless render failed (${page.renderEvidence?.renderError || 'unknown'}) — no headline verdict for this URL`,
          url: page.finalUrl,
        })
      }
      await store.updateUrlJob(job.id, {
        status: 'crawled',
        httpStatus: page.status,
        finalUrl: page.finalUrl,
        streamComplete: true,
        clientOnly: false,
        html: page.html,
        renderMode: page.renderMode,
        rawHtmlHash: page.rawHtmlHash,
        renderedHtmlHash: page.renderedHtmlHash,
      })
      crawled.push(page)

      // Link-graph frontier expansion (same-host <a href> only).
      const links = extractSameHostLinks(page.html, page.finalUrl, run.origin).filter(
        (u) => isSafePublicUrl(u) && !isDisallowedByRobots(u, robotsRules),
      )
      if (links.length > 0) {
        let toAdd = links
        if (run.urlCap != null) {
          const room = Math.max(0, run.urlCap - urlsDiscovered)
          toAdd = links.slice(0, room)
        } else if (urlsDiscovered >= CRAWL_MAX_DISCOVERED) {
          toAdd = []
        } else {
          toAdd = links.slice(0, CRAWL_MAX_DISCOVERED - urlsDiscovered)
        }
        const added = await store.enqueueUrlsReturningNew(runId, toAdd)
        if (added > 0) {
          urlsDiscovered += added
          urlsFound = Math.max(urlsFound, urlsDiscovered)
          linkGraphAdded += added
          notes.push({
            code: 'link_graph_expand',
            detail: `Enqueued ${added} same-host URL(s) from crawlable links on ${page.finalUrl}`,
            url: page.finalUrl,
          })
        }
      }
    } catch (err) {
      failedN++
      const detail = err instanceof Error ? err.message : String(err)
      await store.updateUrlJob(job.id, {
        status: 'failed',
        errorDetail: detail,
      })
      notes.push({ code: 'fetch_failure', detail, url: job.url })
    }
  }

  if (crawled.length > 0) {
    // PER-PAGE detectors only — WHOLE-SITE runs after frontier drain.
    // Prefer rendered HTML already on CrawledPage.html; skip headline
    // detectors for pages that needed render but failed (handled as client_only).
    const priorFiveXXByUrl = await buildPriorFiveXXByUrl(store, run)
    const emits = await runDetectorsOnPages(run.origin, crawled, priorFiveXXByUrl)
    const mismatchEmits = crawled.flatMap((p) => {
      if (!p.renderEvidence || p.renderMode !== 'rendered') return []
      const host = (() => {
        try {
          return new URL(run.origin).hostname
        } catch {
          return 'localhost'
        }
      })()
      const m = buildRawRenderMismatch({
        pageUrl: p.finalUrl,
        evidence: p.renderEvidence,
        originHost: host,
      })
      if (!m) return []
      return [
        {
          topicId: '67',
          kind: 'crawl/raw-render-mismatch',
          bucket: 'informational' as const,
          verdict: m.verdict,
          severity: 'informational',
          pageUrl: p.finalUrl,
          declarationSite: p.finalUrl,
          detail: m.detail,
          autoFixable: false,
          proposedDiff: null,
          evidenceValues: m.evidence,
        },
      ]
    })
    await store.appendRunEmits(runId, [...emits, ...mismatchEmits])

    // Persist render evidence rows (best-effort; ignore when table absent in tests).
    try {
      const { persistPageRenderEvidenceBatch } = await import(
        '@/lib/crawl-render/persist-evidence'
      )
      await persistPageRenderEvidenceBatch({
        runId,
        userId: run.userId,
        pages: crawled,
        jobs: await store.listJobsForRun(runId),
      })
    } catch {
      /* memory store / missing table */
    }
  }

  const counts = await store.countJobsByStatus(runId)
  const stillQueued = counts.queued
  const done = stillQueued === 0 && counts.running === 0

  // WHOLE-SITE detectors once the frontier is drained (avoids chunk false
  // positives — same fix class as topic 43 orphans on a per-chunk graph).
  if (done) {
    const allJobs = await store.listJobsForRun(runId)
    const sitemapUrls = new Set(
      allJobs.map((j) => j.url.replace(/\/$/, '')),
    )
    const wholeSitePages = allJobs
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
    const wholeSiteEmits = await runWholeSiteDetectorsOnCrawl(
      run.origin,
      wholeSitePages,
    )
    for (const topicId of POST_CRAWL_TOPIC_IDS) {
      await store.replaceRunEmitsForTopic(
        runId,
        topicId,
        wholeSiteEmits.filter((e) => e.topicId === topicId),
      )
    }
  }

  const allEmits = await store.listRunEmits(runId)
  const { findings, internalEvidence } = rollupAndClassify(allEmits)
  await store.clearRunEvidence(runId)
  await store.upsertFindings({
    siteId: run.siteId,
    detectOrigin: run.detectOrigin,
    userId: run.userId,
    runId,
    findings,
    internalEvidence,
  })

  // Mid-tick time_limit with work left → stay running (resume on next tick).
  // Terminal partial when queue drains but coverage is incomplete.
  const enduringCodes = new Set([
    'client_only',
    'fetch_failure',
    'crawler_backoff',
    'stream_incomplete',
    'discovery_cap',
    'plan_page_limit',
    'render_failed',
  ])
  const coverageIncomplete =
    clientOnlyN > 0 ||
    failedN > 0 ||
    pagesRenderFailedN > 0 ||
    notes.some((n) => enduringCodes.has(n.code)) ||
    (urlsFound > 0 && urlsDiscovered < urlsFound && done) ||
    run.isPartial

  let status: CrawlRunRecordStatus = 'running'
  let isPartial = coverageIncomplete
  if (done) {
    status = coverageIncomplete ? 'partial' : 'complete'
    isPartial = coverageIncomplete
  } else if (stillQueued > 0 && notes.some((n) => n.code === 'time_limit')) {
    status = 'running'
    isPartial = coverageIncomplete
  }

  await store.updateRun(runId, {
    status,
    urlsCrawled: crawledN,
    urlsFailed: failedN,
    urlsClientOnly: clientOnlyN,
    pagesRendered: pagesRenderedN,
    pagesRenderFailed: pagesRenderFailedN,
    totalRenderTimeMs: totalRenderTimeMsN,
    urlsDiscovered,
    urlsFound,
    chunkSize: adaptiveChunk,
    discoverySeeds: {
      ...seedsBase,
      fromLinkGraph: linkGraphAdded,
    },
    coverageNotes: dedupeNotes(notes),
    isPartial,
    finishedAt: done ? new Date().toISOString() : null,
    errorDetail: null,
  })

  // Findings close on a genuinely complete crawl only — a partial run never
  // had full coverage, so a finding's absence from it proves nothing (the
  // page that would have re-raised it may not have been re-crawled at all).
  if (status === 'complete') {
    await store.resolveAbsentFindings({
      siteId: run.siteId,
      detectOrigin: run.detectOrigin,
      userId: run.userId,
      runId,
    })
  }

  return {
    runId,
    status,
    processedThisTick: jobs.length,
    remainingQueued: stillQueued,
    isPartial,
    coverageNotes: dedupeNotes(notes),
    done,
  }
}

type CrawlRunRecordStatus = 'queued' | 'running' | 'complete' | 'failed' | 'partial'

function dedupeNotes(notes: CoverageNote[]): CoverageNote[] {
  const seen = new Set<string>()
  const out: CoverageNote[] = []
  for (const n of notes) {
    const key = `${n.code}|${n.url ?? ''}|${n.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

/**
 * Run all ticks until complete (CLI / live verification).
 */
export async function runCrawlToCompletion(
  input: StartCrawlInput,
): Promise<{
  runId: string
  durationMs: number
  urlsFound: number
  urlsDiscovered: number
  urlsCrawled: number
  urlsClientOnly: number
  urlCap: number | null
  discoverySeeds: {
    fromRobotsSitemaps: number
    fromSitemapFallback: number
    fromHomepage: number
    fromLinkGraph: number
  } | null
  status: string
  isPartial: boolean
  coverageNotes: CoverageNote[]
  counts: { actionable: number; informational: number; internal: number }
}> {
  const store = input.store ?? getFindingsStore()
  const started = Date.now()
  const { runId, urlsDiscovered, urlsFound } = await startCrawlRun(input)

  let guard = 0
  while (guard++ < 500) {
    const tick = await processCrawlTick(runId, { store })
    if (tick.done) break
  }

  const run = await store.getRun(runId)
  if (!run) throw new Error('run vanished')
  const counts = await store.counts(
    run.detectOnly
      ? { detectOrigin: run.detectOrigin, userId: run.userId }
      : { siteId: run.siteId },
  )

  return {
    runId,
    durationMs: Date.now() - started,
    urlsFound: run.urlsFound || urlsFound,
    urlsDiscovered: run.urlsDiscovered || urlsDiscovered,
    urlsCrawled: run.urlsCrawled,
    urlsClientOnly: run.urlsClientOnly,
    urlCap: run.urlCap,
    discoverySeeds: run.discoverySeeds,
    status: run.status,
    isPartial: run.isPartial,
    coverageNotes: run.coverageNotes,
    counts,
  }
}
