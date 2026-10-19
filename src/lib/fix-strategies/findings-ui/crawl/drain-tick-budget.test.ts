/**
 * Regression: a drain that hits its in-process tick budget must leave the
 * crawl running for the next heartbeat — never mark failed while URLs remain.
 * Only the 15-minute no-progress watchdog may fail a stalled crawl.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMemoryFindingsStore } from './store'
import { drainCrawlRunToTerminal } from './scheduled-recrawl'
import { processCrawlTick } from './orchestrator'

vi.mock('./fetch-page', () => ({
  crawlOneUrl: async (url: string) => ({
    url,
    finalUrl: url,
    status: 200,
    html: '<html><body><h1>Ok</h1><p>content words here</p></body></html>',
    streamComplete: true,
    clientOnly: false,
    crawlerCausedBackoff: false,
    errorDetail: null,
    renderMode: 'http' as const,
    rawHtmlHash: 'raw',
    renderedHtmlHash: null,
    renderEvidence: null,
    evidence: { attempts: [{ url, status: 200 }] },
  }),
}))

vi.mock('./discover', () => ({
  discoverSameHostUrls: async () => ({
    urls: [],
    seeds: {
      fromRobotsSitemaps: 0,
      fromSitemapFallback: 0,
      fromHomepage: 0,
      fromLinkGraph: 0,
    },
  }),
  extractSameHostLinks: () => [],
}))

vi.mock('./run-detectors', () => ({
  runDetectorsOnPages: async () => [],
  rollupAndClassify: () => ({ findings: [], internalEvidence: [] }),
}))

describe('drainCrawlRunToTerminal tick budget', () => {
  it('does not fail when maxTicks runs out mid-frontier; next drain completes', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-budget',
      userId: 'u-budget',
      origin: 'https://budget.example',
    })
    // Many URLs + zero deadline so one tick cannot finish the frontier.
    const urls = Array.from(
      { length: 20 },
      (_, i) => `https://budget.example/p${i}`,
    )
    await store.enqueueUrls(run.id, urls)
    await store.updateRun(run.id, {
      status: 'queued',
      urlsDiscovered: urls.length,
      urlsFound: urls.length,
      postCrawlPhase: 'done',
    })

    // Force mid-frontier stop via deadlineMs=0 on processCrawlTick path:
    // drainCrawlRunToTerminal uses default deadlines, so simulate with one
    // zero-deadline tick then resume.
    const midTick = await processCrawlTick(run.id, { store, deadlineMs: 0 })
    expect(midTick.done).toBe(false)
    expect(midTick.remainingQueued).toBeGreaterThan(0)

    const afterBudget = await store.getRun(run.id)
    expect(afterBudget!.status).toBe('running')
    expect(afterBudget!.finishedAt).toBeNull()
    expect(afterBudget!.errorDetail).toBeNull()

    // A later drain (heartbeat / e2e continue) finishes the same run.
    const final = await drainCrawlRunToTerminal(run.id, store, { maxTicks: 20 })
    expect(final.done).toBe(true)
    expect(['complete', 'partial']).toContain(final.status)
    expect(final.finishedAt).toBeTruthy()

    const done = await store.getRun(run.id)
    expect(done!.errorDetail).toBeNull()
    const counts = await store.countJobsByStatus(run.id)
    expect(counts.queued).toBe(0)
    expect(counts.running).toBe(0)
  })

  it('single tick drains a 15-URL frontier (multi-chunk) under soft budget', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-fifteen',
      userId: 'u',
      origin: 'https://fifteen.example',
    })
    const urls = Array.from(
      { length: 15 },
      (_, i) => `https://fifteen.example/p${i}`,
    )
    await store.enqueueUrls(run.id, urls)
    await store.updateRun(run.id, {
      status: 'queued',
      urlsDiscovered: urls.length,
      urlsFound: urls.length,
      postCrawlPhase: 'done',
    })

    const tick = await processCrawlTick(run.id, { store, deadlineMs: 60_000 })
    expect(tick.processedThisTick).toBe(15)
    expect(tick.remainingQueued).toBe(0)
    expect(tick.done).toBe(true)
    expect(['complete', 'partial']).toContain(tick.status)
    expect(tick.timings?.chunksClaimed).toBeGreaterThanOrEqual(3)
    expect(tick.timings?.urlFetchMs).toBeGreaterThanOrEqual(0)
  })

  it('stops claiming more chunks when soft deadline is already past', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-deadline',
      userId: 'u',
      origin: 'https://deadline.example',
    })
    const urls = Array.from(
      { length: 12 },
      (_, i) => `https://deadline.example/p${i}`,
    )
    await store.enqueueUrls(run.id, urls)
    await store.updateRun(run.id, {
      status: 'queued',
      urlsDiscovered: urls.length,
      urlsFound: urls.length,
      postCrawlPhase: 'done',
    })

    // Deadline already elapsed → at most one chunk attempt, leave rest queued.
    const tick = await processCrawlTick(run.id, { store, deadlineMs: 0 })
    expect(tick.done).toBe(false)
    expect(tick.remainingQueued).toBeGreaterThan(0)
    expect(tick.processedThisTick).toBeLessThan(12)
  })
})
