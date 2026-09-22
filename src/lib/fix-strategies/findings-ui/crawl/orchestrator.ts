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
import { discoverSameHostUrls, extractSameHostLinks } from './discover'
import { crawlOneUrl, type CrawledPage } from './fetch-page'
import {
  runDetectorsOnPages,
  runWholeSiteDetectorsOnCrawl,
  rollupAndClassify,
} from './run-detectors'
import { POST_CRAWL_TOPIC_IDS } from '@/lib/fix-strategies/detector-scope'
import { getFindingsStore, type FindingsStore } from './store'

export type StartCrawlInput = {
  /** Connected site id, or null for detection-only. */
  siteId: string | null
  userId: string
  origin: string
  /** Public URL, no connected_sites row, no repo credentials. */
  detectOnly?: boolean
  store?: FindingsStore
  /**
   * Optional extra enqueue cap (tests). Hitting this (or CRAWL_MAX_DISCOVERED)
   * marks the run partial — never complete.
   */
  maxUrls?: number
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
    notes.push({
      code: 'discovery_cap',
      detail: `enqueue capped at maxUrls=${input.maxUrls}: found ${foundTotal} same-host URLs, enqueued ${urls.length}, ${foundTotal - urls.length} not crawled`,
    })
  } else if (discovered.capped) {
    urlCap = CRAWL_MAX_DISCOVERED
  }

  if (discovered.skippedOffHost > 0) {
    notes.push({
      code: 'off_host',
      detail: `Skipped ${discovered.skippedOffHost} off-host sitemap loc(s)`,
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

  return { runId: run.id, urlsDiscovered: urls.length, urlsFound: foundTotal }
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

  const jobs = await store.claimUrlChunk(runId, chunkSize)
  const crawled: CrawledPage[] = []
  const notes: CoverageNote[] = [...run.coverageNotes]
  let crawledN = run.urlsCrawled
  let failedN = run.urlsFailed
  let clientOnlyN = run.urlsClientOnly
  let urlsDiscovered = run.urlsDiscovered
  let urlsFound = run.urlsFound
  let linkGraphAdded = run.discoverySeeds?.fromLinkGraph ?? 0
  const seedsBase = run.discoverySeeds ?? {
    fromRobotsSitemaps: 0,
    fromSitemapFallback: 0,
    fromHomepage: 0,
    fromLinkGraph: 0,
  }

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
      const page = await crawlOneUrl(job.url)
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
          html: page.html || '',
        })
        notes.push({
          code: 'client_only',
          detail:
            'Served HTML looks client_only — content detectors skipped; outbound links may appear only after rendering (topic 67)',
          url: job.url,
        })
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
      await store.updateUrlJob(job.id, {
        status: 'crawled',
        httpStatus: page.status,
        finalUrl: page.finalUrl,
        streamComplete: true,
        clientOnly: false,
        html: page.html,
      })
      crawled.push(page)

      // Link-graph frontier expansion (same-host <a href> only).
      const links = extractSameHostLinks(page.html, page.finalUrl, run.origin)
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
    const emits = await runDetectorsOnPages(run.origin, crawled)
    await store.appendRunEmits(runId, emits)
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
  ])
  const coverageIncomplete =
    clientOnlyN > 0 ||
    failedN > 0 ||
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
    urlsDiscovered,
    urlsFound,
    discoverySeeds: {
      ...seedsBase,
      fromLinkGraph: linkGraphAdded,
    },
    coverageNotes: dedupeNotes(notes),
    isPartial,
    finishedAt: done ? new Date().toISOString() : null,
    errorDetail: null,
  })

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
