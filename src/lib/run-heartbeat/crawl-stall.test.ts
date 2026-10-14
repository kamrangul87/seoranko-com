/**
 * Regression: SPA / render-heavy crawls must finish or fail clearly — never
 * sit in status=running until the 15m watchdog with a silent cursor.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMemoryFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl/store'
import { processCrawlTick } from '@/lib/fix-strategies/findings-ui/crawl/orchestrator'
import { runHeartbeat, CRAWL_TICK_LEASE_MS, type HeartbeatDeps } from './heartbeat'

vi.mock('@/lib/fix-strategies/findings-ui/crawl/fetch-page', () => ({
  crawlOneUrl: async (url: string, opts?: { skipRender?: boolean }) => {
    const renderNeeded = true
    if (opts?.skipRender) {
      return {
        url,
        finalUrl: url,
        status: 200,
        html: '<html><body><div id="root"></div></body></html>',
        streamComplete: true,
        clientOnly: true,
        crawlerCausedBackoff: false,
        errorDetail: null,
        renderMode: 'http' as const,
        rawHtmlHash: 'raw',
        renderedHtmlHash: null,
        renderEvidence: {
          renderNeeded: true,
          renderNeededReasons: ['root_empty'],
          renderError: 'skip_render',
          renderTookMs: 0,
        },
        evidence: { attempts: [{ url, status: 200 }] },
      }
    }
    return {
      url,
      finalUrl: url,
      status: 200,
      html: '<html><body><h1>Rendered</h1><p>content</p></body></html>',
      streamComplete: true,
      clientOnly: false,
      crawlerCausedBackoff: false,
      errorDetail: null,
      renderMode: 'rendered' as const,
      rawHtmlHash: 'raw',
      renderedHtmlHash: 'ren',
      renderEvidence: {
        renderNeeded: true,
        renderNeededReasons: ['root_empty'],
        renderError: null,
        renderTookMs: 120,
      },
      evidence: { attempts: [{ url, status: 200 }] },
    }
  },
}))

vi.mock('@/lib/fix-strategies/findings-ui/crawl/discover', () => ({
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

vi.mock('@/lib/fix-strategies/findings-ui/crawl/run-detectors', () => ({
  runDetectorsOnPages: async () => [],
  rollupAndClassify: () => ({ findings: [], internalEvidence: [] }),
}))

describe('SPA crawl stall regression', () => {
  it('heartbeat alone drains a render-heavy queue without stalling', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-spa',
      userId: 'u-spa',
      origin: 'https://spa.example',
    })
    const urls = Array.from({ length: 6 }, (_, i) => `https://spa.example/p${i}`)
    await store.enqueueUrls(run.id, urls)
    await store.updateRun(run.id, {
      status: 'queued',
      urlsDiscovered: urls.length,
      urlsFound: urls.length,
      // Pretend prior tick already paid render cost → adaptive chunk = 2
      pagesRendered: 1,
      postCrawlPhase: 'done', // focus URL drain; post-crawl covered elsewhere
    })

    let leaseMsSeen = 0
    const deps: HeartbeatDeps = {
      nowMs: () => Date.now(),
      listUnfinished: async () => {
        const r = await store.getRun(run.id)
        if (!r || r.status !== 'queued' && r.status !== 'running') return []
        return [
          {
            kind: 'crawl',
            id: run.id,
            siteId: r.siteId,
            lastProgressAt: r.updatedAt,
            leaseUntil: null,
          },
        ]
      },
      claimRun: async (_k, _id, leaseUntilIso) => {
        leaseMsSeen = Date.parse(leaseUntilIso) - Date.now()
        return true
      },
      tickCrawl: async (id) => {
        const tick = await processCrawlTick(id, {
          store,
          // Generous deadline so deferred renders aren't time_limit noise
          deadlineMs: 60_000,
        })
        return {
          advanced:
            tick.processedThisTick > 0 ||
            Boolean(tick.done) ||
            tick.status !== 'running',
        }
      },
      tickFix: async () => ({ advanced: false }),
      tickE2e: async () => ({ advanced: false }),
      markProgress: async () => {
        await store.updateRun(run.id, {})
      },
      failStalled: async () => {
        throw new Error('watchdog must not fire during active SPA drain')
      },
    }

    for (let i = 0; i < 10; i++) {
      const r = await store.getRun(run.id)
      if (r && (r.status === 'complete' || r.status === 'partial' || r.status === 'failed')) {
        break
      }
      await runHeartbeat(deps)
    }

    expect(leaseMsSeen).toBeGreaterThanOrEqual(CRAWL_TICK_LEASE_MS - 5_000)
    const final = await store.getRun(run.id)
    expect(final).toBeTruthy()
    expect(['complete', 'partial']).toContain(final!.status)
    expect(final!.errorDetail).toBeNull()
    const counts = await store.countJobsByStatus(run.id)
    expect(counts.queued).toBe(0)
    expect(counts.running).toBe(0)
  })

  it('fails clearly when claim returns 0 with URLs still queued', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-stuck',
      userId: 'u',
      origin: 'https://stuck.example',
    })
    await store.enqueueUrls(run.id, ['https://stuck.example/a'])
    await store.updateRun(run.id, {
      status: 'running',
      urlsDiscovered: 1,
      urlsFound: 1,
      postCrawlPhase: 'done',
    })

    store.claimUrlChunk = async () => []
    const counts = await store.countJobsByStatus(run.id)
    expect(counts.queued).toBe(1)

    const tick = await processCrawlTick(run.id, { store })
    expect(tick.done).toBe(true)
    expect(tick.status).toBe('failed')
    expect(tick.remainingQueued).toBeGreaterThan(0)
    const failed = await store.getRun(run.id)
    expect(failed!.errorDetail).toMatch(/claimed 0/i)
  })
})

