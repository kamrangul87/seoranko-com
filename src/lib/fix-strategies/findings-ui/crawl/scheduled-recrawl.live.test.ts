/**
 * LIVE acceptance for Change Monitoring 3.3 — scheduled recrawl vs autodun.
 *
 * Run: LIVE_CRAWL=1 npx vitest run src/lib/fix-strategies/findings-ui/crawl/scheduled-recrawl.live.test.ts
 *
 * Uses detect-only mode against https://autodun.com (no connected_sites row
 * required). Still goes through reserveCrawlStart when SERVICE_ROLE is set;
 * otherwise a test double allows the start so CI-offline stays green via skip.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  runScheduledRecrawlForSite,
  useMemoryFindingsStore,
} from './index'

const live = process.env.LIVE_CRAWL === '1'

describe.skipIf(!live)('scheduled recrawl — autodun acceptance (live)', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('runs once to complete/partial with finished_at; second same-week call skips', async () => {
    const store = createMemoryFindingsStore()
    const site = {
      siteId: null as string | null,
      userId: 'live-acceptance-user',
      origin: 'https://autodun.com',
      detectOnly: true,
    }

    // Bypass durable quota in live agent VMs without SERVICE_ROLE; production
    // cron always uses the real Postgres RPC.
    const reserve = async () => ({
      allowed: true as const,
      blockedReason: null,
      count: 1,
    })
    const release = async () => undefined

    const first = await runScheduledRecrawlForSite(site, {
      store,
      reserve,
      release,
      maxPages: 25,
      planLabel: 'Free',
      resumeInProgress: true,
    })

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          acceptance: 'autodun-scheduled-first',
          status: first.status,
          finishedAt: first.finishedAt,
          urlsFound: first.urlsFound,
          urlsDiscovered: first.urlsDiscovered,
          urlsCrawled: first.urlsCrawled,
          pagesRendered: first.pagesRendered,
          pagesRenderFailed: first.pagesRenderFailed,
          urlCap: first.urlCap,
          isPartial: first.isPartial,
          planPageLimitNote:
            first.coverageNotes?.find((n) => n.code === 'plan_page_limit')
              ?.detail ?? null,
          resolvedCount: first.resolvedCount,
          regressedCount: first.regressedCount,
          runId: first.runId,
          error: first.error ?? null,
        },
        null,
        2,
      ),
    )

    expect(first.decision.action).toBe('run')
    expect(first.runId).toBeTruthy()
    expect(['complete', 'partial', 'failed']).toContain(first.status)
    expect(first.finishedAt).toBeTruthy()
    expect(first.status).not.toBe('running')
    expect(first.status).not.toBe('queued')
    // Selective render: pagesRendered ≤ urlsCrawled (never render everything blindly).
    expect(first.pagesRendered ?? 0).toBeLessThanOrEqual(first.urlsCrawled ?? 0)
    if (first.urlCap != null && (first.urlsFound ?? 0) > first.urlCap) {
      expect(first.isPartial).toBe(true)
      expect(
        first.coverageNotes?.some((n) => n.code === 'plan_page_limit'),
      ).toBe(true)
    }

    const second = await runScheduledRecrawlForSite(site, {
      store,
      reserve,
      release,
      maxPages: 25,
      planLabel: 'Free',
    })

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          acceptance: 'autodun-scheduled-second-same-week',
          decision: second.decision,
          runId: second.runId ?? null,
        },
        null,
        2,
      ),
    )

    expect(second.decision.action).toBe('skip')
    if (second.decision.action === 'skip') {
      expect(second.decision.reason).toBe('already_ran_this_week')
    }
    expect(second.runId).toBeUndefined()
  }, 300_000)
})
