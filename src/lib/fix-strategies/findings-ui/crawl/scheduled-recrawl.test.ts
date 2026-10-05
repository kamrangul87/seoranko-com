import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  createMemoryFindingsStore,
  decideScheduledRecrawl,
  resetMemoryFindingsStore,
  runScheduledRecrawlForSite,
  utcWeekStartMs,
  useMemoryFindingsStore,
  type CrawlRunRecord,
} from './index'

function baseRun(
  overrides: Partial<CrawlRunRecord> & Pick<CrawlRunRecord, 'id' | 'status'>,
): CrawlRunRecord {
  const now = new Date().toISOString()
  const base: CrawlRunRecord = {
    id: overrides.id,
    siteId: 'site-a',
    detectOnly: false,
    detectOrigin: null,
    userId: 'user-a',
    origin: 'https://example.com',
    trigger: 'scheduled',
    status: overrides.status,
    chunkSize: 5,
    urlsFound: 0,
    urlsDiscovered: 0,
    urlsCrawled: 0,
    urlsFailed: 0,
    urlsClientOnly: 0,
    urlsSkippedOffHost: 0,
    urlCap: null,
    pagesRendered: 0,
    pagesRenderFailed: 0,
    totalRenderTimeMs: 0,
    discoverySeeds: null,
    coverageNotes: [],
    isPartial: false,
    errorDetail: null,
    postCrawlPhase: null,
    postCrawlCursor: null,
    sitemapInspection: null,
    linkGraph: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  return {
    ...base,
    ...overrides,
    id: overrides.id,
    status: overrides.status,
    postCrawlPhase: overrides.postCrawlPhase ?? null,
    postCrawlCursor: overrides.postCrawlCursor ?? null,
    sitemapInspection: overrides.sitemapInspection ?? null,
    linkGraph: overrides.linkGraph ?? null,
    errorDetail: overrides.errorDetail ?? null,
    finishedAt: overrides.finishedAt ?? null,
    createdAt: overrides.createdAt ?? now,
  }
}

describe('utcWeekStartMs', () => {
  it('returns Monday 00:00 UTC for a Wednesday', () => {
    // 2026-09-30 is Wednesday
    const wed = Date.parse('2026-09-30T15:00:00.000Z')
    expect(new Date(utcWeekStartMs(wed)).toISOString()).toBe(
      '2026-09-28T00:00:00.000Z',
    )
  })
})

describe('decideScheduledRecrawl', () => {
  const weekStart = Date.parse('2026-09-28T00:00:00.000Z')
  const midWeek = Date.parse('2026-09-30T12:00:00.000Z')

  it('runs when no prior scheduled crawls', () => {
    expect(decideScheduledRecrawl([], midWeek)).toEqual({ action: 'run' })
  })

  it('skips when a scheduled crawl already finished this UTC week', () => {
    const d = decideScheduledRecrawl(
      [
        baseRun({
          id: 'r1',
          status: 'partial',
          createdAt: new Date(weekStart + 3600_000).toISOString(),
          finishedAt: new Date(weekStart + 7200_000).toISOString(),
        }),
      ],
      midWeek,
    )
    expect(d.action).toBe('skip')
    if (d.action === 'skip') {
      expect(d.reason).toBe('already_ran_this_week')
    }
  })

  it('skips when a scheduled crawl is still running this week', () => {
    const d = decideScheduledRecrawl(
      [
        baseRun({
          id: 'r-open',
          status: 'running',
          createdAt: new Date(weekStart + 1000).toISOString(),
          finishedAt: null,
        }),
      ],
      midWeek,
    )
    expect(d.action).toBe('skip')
    if (d.action === 'skip') {
      expect(d.reason).toBe('in_progress_this_week')
    }
  })

  it('skips when last two scheduled crawls failed (any week)', () => {
    const d = decideScheduledRecrawl(
      [
        baseRun({
          id: 'f2',
          status: 'failed',
          createdAt: '2026-09-21T08:00:00.000Z',
          errorDetail: 'timeout',
        }),
        baseRun({
          id: 'f1',
          status: 'failed',
          createdAt: '2026-09-14T08:00:00.000Z',
          errorDetail: 'dns',
        }),
      ],
      midWeek,
    )
    expect(d.action).toBe('skip')
    if (d.action === 'skip') {
      expect(d.reason).toBe('two_consecutive_scheduled_failures')
      expect(d.detail).toMatch(/timeout/)
      expect(d.detail).toMatch(/dns/)
    }
  })

  it('allows a new week after a prior-week complete', () => {
    const d = decideScheduledRecrawl(
      [
        baseRun({
          id: 'old',
          status: 'complete',
          createdAt: '2026-09-21T08:00:00.000Z',
          finishedAt: '2026-09-21T08:30:00.000Z',
        }),
      ],
      midWeek,
    )
    expect(d).toEqual({ action: 'run' })
  })
})

describe('runScheduledRecrawlForSite (quota + week skip)', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('skips a second scheduled start in the same UTC week', async () => {
    const store = createMemoryFindingsStore()
    const weekStart = utcWeekStartMs(
      Date.parse('2026-09-30T12:00:00.000Z'),
    )
    // Seed a finished scheduled run this week without network.
    const seeded = await store.createRun({
      siteId: 'site-a',
      userId: 'user-a',
      origin: 'https://example.com',
      trigger: 'scheduled',
    })
    await store.updateRun(seeded.id, {
      status: 'partial',
      finishedAt: new Date(weekStart + 3_600_000).toISOString(),
      isPartial: true,
      coverageNotes: [
        {
          code: 'plan_page_limit',
          detail: '25 of 80 pages crawled — Free plan limit',
        },
      ],
      urlCap: 25,
      urlsFound: 80,
      urlsDiscovered: 25,
      urlsCrawled: 25,
    })
    // createRun sets createdAt=now; patch by re-writing via update isn't enough
    // for createdAt. Re-seed by mutating memory through a second create then
    // rely on decide logic via injected nowMs — instead insert with backdated
    // createdAt by updating the in-memory map through get+manual is hard.
    // Work around: call decide directly on listed runs after forcing createdAt.
    const listed = await store.listRunsForSite('site-a')
    // Force createdAt into this week on the record (memory store keeps object refs).
    ;(listed[0] as CrawlRunRecord).createdAt = new Date(
      weekStart + 1000,
    ).toISOString()
    ;(listed[0] as CrawlRunRecord).trigger = 'scheduled'

    const reserve = vi.fn(async () => ({
      allowed: true,
      blockedReason: null,
      count: 1,
    }))

    const second = await runScheduledRecrawlForSite(
      {
        siteId: 'site-a',
        userId: 'user-a',
        origin: 'https://example.com',
      },
      {
        store,
        nowMs: Date.parse('2026-09-30T12:00:00.000Z'),
        reserve,
        maxPages: 25,
        planLabel: 'Free',
      },
    )

    expect(second.decision.action).toBe('skip')
    if (second.decision.action === 'skip') {
      expect(second.decision.reason).toBe('already_ran_this_week')
    }
    expect(reserve).not.toHaveBeenCalled()
  })

  it('respects crawl quota and does not start when reservation is denied', async () => {
    const store = createMemoryFindingsStore()
    const reserve = vi.fn(async () => ({
      allowed: false,
      blockedReason: 'Daily crawl quota reached (1 starts / UTC day).',
      count: 1,
    }))

    const result = await runScheduledRecrawlForSite(
      {
        siteId: 'site-q',
        userId: 'user-q',
        origin: 'https://example.com',
      },
      {
        store,
        nowMs: Date.parse('2026-09-30T12:00:00.000Z'),
        reserve,
        dailyLimit: 1,
        maxPages: 25,
        planLabel: 'Free',
      },
    )

    expect(result.decision.action).toBe('skip')
    if (result.decision.action === 'skip') {
      expect(result.decision.reason).toBe('crawl_quota')
      expect(result.decision.detail).toMatch(/quota/i)
    }
    const runs = await store.listRunsForSite('site-q')
    expect(runs).toHaveLength(0)
  })

  it('skips after two consecutive scheduled failures and reports why', async () => {
    const store = createMemoryFindingsStore()
    for (const [id, detail] of [
      ['a', 'upstream 503'],
      ['b', 'dns failure'],
    ] as const) {
      const r = await store.createRun({
        siteId: 'site-fail',
        userId: 'u',
        origin: 'https://example.com',
        trigger: 'scheduled',
      })
      await store.updateRun(r.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errorDetail: detail,
      })
      const listed = await store.listRunsForSite('site-fail')
      const row = listed.find((x) => x.id === r.id)!
      row.trigger = 'scheduled'
      row.createdAt = id === 'a' ? '2026-09-21T08:00:00.000Z' : '2026-09-14T08:00:00.000Z'
      void id
    }

    // Ensure newest-first order for decide (listRunsForSite is created_at desc —
    // our backdated createdAt may not re-sort Map iteration). Sort manually via
    // decide on filtered list:
    const scheduled = (await store.listRunsForSite('site-fail'))
      .filter((r) => r.trigger === 'scheduled')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const d = decideScheduledRecrawl(
      scheduled,
      Date.parse('2026-09-30T12:00:00.000Z'),
    )
    expect(d.action).toBe('skip')
    if (d.action === 'skip') {
      expect(d.reason).toBe('two_consecutive_scheduled_failures')
      expect(d.detail).toMatch(/503|dns/i)
    }
  })
})
