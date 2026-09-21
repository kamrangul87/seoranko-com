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
import { discoverSameHostUrls } from './discover'
import { crawlOneUrl, type CrawledPage } from './fetch-page'
import { runDetectorsOnPages, rollupAndClassify } from './run-detectors'
import { getFindingsStore, type FindingsStore } from './store'

export type StartCrawlInput = {
  siteId: string
  userId: string
  origin: string
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
  const run = await store.createRun({
    siteId: input.siteId,
    userId: input.userId,
    origin: input.origin.replace(/\/$/, ''),
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

  await store.enqueueUrls(run.id, urls)
  await store.updateRun(run.id, {
    status: 'queued',
    urlsFound: foundTotal,
    urlsDiscovered: urls.length,
    urlsSkippedOffHost: discovered.skippedOffHost,
    urlCap,
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
        })
        notes.push({
          code: 'client_only',
          detail:
            'Served HTML looks client-only — content detectors skipped (topic 67)',
          url: job.url,
        })
        // Still keep page for link-graph if it has any HTML
        if (page.html) crawled.push(page)
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
      })
      crawled.push(page)
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
    const priorEmits = await store.listRunEmits(runId)
    const emits = await runDetectorsOnPages(run.origin, crawled, {
      // Site-level sitemap/robots detectors once per run (not every chunk).
      runSiteLevel: priorEmits.length === 0,
    })
    await store.appendRunEmits(runId, emits)
    // Re-roll from all emits this run so chunk boundaries don't under-count
    // generator-level rollups (UNIQUE site+topic+rollup_key upsert).
    const allEmits = await store.listRunEmits(runId)
    const { findings, internalEvidence } = rollupAndClassify(allEmits)
    await store.clearRunEvidence(runId)
    await store.upsertFindings({
      siteId: run.siteId,
      userId: run.userId,
      runId,
      findings,
      internalEvidence,
    })
  }

  const counts = await store.countJobsByStatus(runId)
  const stillQueued = counts.queued
  const done = stillQueued === 0 && counts.running === 0

  // Mid-tick time_limit with work left → stay running (resume on next tick).
  // Terminal partial when queue drains but coverage is incomplete:
  // discovery/maxUrls cap, client_only, fetch failures, backoff, stream gaps.
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
    (run.urlsFound > 0 && run.urlsDiscovered < run.urlsFound) ||
    run.isPartial

  let status: CrawlRunRecordStatus = 'running'
  let isPartial = coverageIncomplete
  if (done) {
    status = coverageIncomplete ? 'partial' : 'complete'
    isPartial = coverageIncomplete
  } else if (stillQueued > 0 && notes.some((n) => n.code === 'time_limit')) {
    // Resume — do not freeze as partial while the frontier is still queued.
    status = 'running'
    isPartial = coverageIncomplete
  }

  await store.updateRun(runId, {
    status,
    urlsCrawled: crawledN,
    urlsFailed: failedN,
    urlsClientOnly: clientOnlyN,
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
  urlCap: number | null
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
  const counts = await store.counts(input.siteId)

  return {
    runId,
    durationMs: Date.now() - started,
    urlsFound,
    urlsDiscovered,
    urlsCrawled: run.urlsCrawled,
    urlCap: run.urlCap,
    status: run.status,
    isPartial: run.isPartial,
    coverageNotes: run.coverageNotes,
    counts,
  }
}
