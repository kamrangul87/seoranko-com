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
    // Small site, more URLs than one chunk (CRAWL_URL_CHUNK_SIZE = 5).
    const urls = Array.from(
      { length: 6 },
      (_, i) => `https://budget.example/p${i}`,
    )
    await store.enqueueUrls(run.id, urls)
    await store.updateRun(run.id, {
      status: 'queued',
      urlsDiscovered: urls.length,
      urlsFound: urls.length,
      postCrawlPhase: 'done',
    })

    // One tick cannot empty a 6-URL frontier (chunk size 5).
    const mid = await drainCrawlRunToTerminal(run.id, store, { maxTicks: 1 })
    expect(mid.done).toBe(false)
    expect(mid.status).toBe('running')
    expect(mid.finishedAt).toBeNull()

    const afterBudget = await store.getRun(run.id)
    expect(afterBudget!.status).toBe('running')
    expect(afterBudget!.finishedAt).toBeNull()
    expect(afterBudget!.errorDetail).toBeNull()
    const midCounts = await store.countJobsByStatus(run.id)
    expect(midCounts.queued + midCounts.running).toBeGreaterThan(0)

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

  it('single-tick processCrawlTick still leaves remaining URLs queued', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-one-tick',
      userId: 'u',
      origin: 'https://one.example',
    })
    const urls = Array.from({ length: 6 }, (_, i) => `https://one.example/p${i}`)
    await store.enqueueUrls(run.id, urls)
    await store.updateRun(run.id, {
      status: 'queued',
      urlsDiscovered: urls.length,
      urlsFound: urls.length,
      postCrawlPhase: 'done',
    })

    const tick = await processCrawlTick(run.id, { store, deadlineMs: 60_000 })
    expect(tick.done).toBe(false)
    expect(tick.status).toBe('running')
    expect(tick.remainingQueued).toBeGreaterThan(0)
  })
})
