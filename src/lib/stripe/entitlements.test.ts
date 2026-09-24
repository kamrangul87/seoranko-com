import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertFixWriteEntitled,
  crawlDailyLimitForUser,
  crawlPageQuotaForUser,
  formatPlanPageLimitMessage,
  isMasterUserEmail,
} from '@/lib/stripe/entitlements'
import {
  reserveCrawlStart,
  releaseCrawlStart,
} from '@/lib/fix-strategies/findings-ui/crawl/rate-limit'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/stripe/client', () => ({
  getStripe: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getStripe } from '@/lib/stripe/client'

function mockSubscriptionRow(
  row: {
    status: string
    plan_id?: string
    stripe_subscription_id?: string
  } | null,
) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: row,
    error: null,
  })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never)
}

describe('isMasterUserEmail', () => {
  afterEach(() => {
    delete process.env.MASTER_EMAIL
  })

  it('matches MASTER_EMAIL case-insensitively from env only', () => {
    process.env.MASTER_EMAIL = 'Owner@Example.com'
    expect(isMasterUserEmail('owner@example.com')).toBe(true)
    expect(isMasterUserEmail('other@example.com')).toBe(false)
  })

  it('returns false when MASTER_EMAIL is unset', () => {
    delete process.env.MASTER_EMAIL
    expect(isMasterUserEmail('anyone@example.com')).toBe(false)
  })
})

describe('assertFixWriteEntitled', () => {
  beforeEach(() => {
    delete process.env.MASTER_EMAIL
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.MASTER_EMAIL
  })

  it('allows master without a subscription row', async () => {
    process.env.MASTER_EMAIL = 'owner@example.com'
    const result = await assertFixWriteEntitled({
      userId: 'u1',
      email: 'owner@example.com',
    })
    expect(result).toEqual({ ok: true, reason: 'master' })
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('allows active subscribers', async () => {
    mockSubscriptionRow({ status: 'active', plan_id: 'seoranko_starter' })
    const result = await assertFixWriteEntitled({ userId: 'u1', email: 'a@b.co' })
    expect(result).toEqual({ ok: true, reason: 'subscription' })
  })

  it('denies free users with 402 + structured upgrade prompt', async () => {
    mockSubscriptionRow(null)
    const result = await assertFixWriteEntitled({ userId: 'u1', email: 'a@b.co' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(402)
      expect(result.code).toBe('SUBSCRIPTION_REQUIRED')
      expect(result.billingPath).toBe('/dashboard/billing')
      expect(result.upgrade.title).toMatch(/Upgrade/i)
      expect(result.upgrade.benefits.length).toBeGreaterThan(0)
      expect(result.upgrade.ctaLabel).toBeTruthy()
    }
  })
})

describe('crawlPageQuotaForUser', () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.MASTER_EMAIL
    delete process.env.STRIPE_SECRET_KEY
  })

  it('returns free 25-page quota by default', async () => {
    mockSubscriptionRow(null)
    await expect(
      crawlPageQuotaForUser({ userId: 'u1', email: 'a@b.co' }),
    ).resolves.toEqual({
      maxPages: FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunFree,
      planLabel: 'free',
      isFree: true,
    })
  })

  it('returns paid default when subscribed and Stripe metadata absent', async () => {
    mockSubscriptionRow({
      status: 'active',
      plan_id: 'seoranko_starter',
      stripe_subscription_id: 'sub_x',
    })
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          metadata: {},
          items: { data: [{ price: { metadata: {}, product: { metadata: {} } } }] },
        }),
      },
    } as never)
    await expect(
      crawlPageQuotaForUser({ userId: 'u1', email: 'a@b.co' }),
    ).resolves.toMatchObject({
      maxPages: FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunPaidDefault,
      planLabel: 'Starter',
      isFree: false,
    })
  })

  it('reads seoranko_crawl_pages from Stripe Price metadata', async () => {
    mockSubscriptionRow({
      status: 'active',
      plan_id: 'seoranko_starter',
      stripe_subscription_id: 'sub_x',
    })
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          metadata: {},
          items: {
            data: [
              {
                price: {
                  metadata: { seoranko_crawl_pages: '750' },
                  product: { metadata: {} },
                },
              },
            ],
          },
        }),
      },
    } as never)
    await expect(
      crawlPageQuotaForUser({ userId: 'u1', email: 'a@b.co' }),
    ).resolves.toMatchObject({ maxPages: 750, isFree: false })
  })
})

describe('formatPlanPageLimitMessage', () => {
  it('names crawled count, found total, and plan', () => {
    expect(
      formatPlanPageLimitMessage({
        crawledOrEnqueued: 25,
        found: 180,
        planLabel: 'free',
      }),
    ).toBe('25 of 180 pages crawled — free plan limit')
  })
})

describe('crawlDailyLimitForUser', () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.MASTER_EMAIL
  })

  it('returns free tier by default', async () => {
    mockSubscriptionRow(null)
    await expect(
      crawlDailyLimitForUser({ userId: 'u1', email: 'a@b.co' }),
    ).resolves.toBe(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDayFree)
  })

  it('returns subscribed tier for active plans and master', async () => {
    mockSubscriptionRow({ status: 'trialing', plan_id: 'seoranko_starter' })
    await expect(
      crawlDailyLimitForUser({ userId: 'u1', email: 'a@b.co' }),
    ).resolves.toBe(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDaySubscribed)

    process.env.MASTER_EMAIL = 'owner@example.com'
    await expect(
      crawlDailyLimitForUser({ userId: 'u1', email: 'owner@example.com' }),
    ).resolves.toBe(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDaySubscribed)
  })
})

describe('reserveCrawlStart with explicit limit', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  // Mocks the two Postgres RPCs (fix_strategies_try_reserve_crawl_start /
  // fix_strategies_release_crawl_start) with the same conditional-increment
  // semantics the real SQL function has, backed by a plain object that
  // lives OUTSIDE reserveCrawlStart's module scope — standing in for "the
  // database". This is what actually distinguishes this from the old
  // in-memory implementation: the counter isn't inside rate-limit.ts at
  // all anymore, it's wherever this mock (in prod: Postgres) says it is.
  function mockCrawlQuotaRpc(counts: Record<string, number> = {}) {
    const rpc = vi.fn((fn: string, args: { p_user_id: string; p_limit?: number }) => {
      const key = args.p_user_id
      if (fn === 'fix_strategies_try_reserve_crawl_start') {
        const cur = counts[key] ?? 0
        if (cur >= (args.p_limit ?? Infinity)) {
          return Promise.resolve({ data: [{ allowed: false, count: cur }], error: null })
        }
        counts[key] = cur + 1
        return Promise.resolve({ data: [{ allowed: true, count: counts[key] }], error: null })
      }
      if (fn === 'fix_strategies_release_crawl_start') {
        counts[key] = Math.max(0, (counts[key] ?? 0) - 1)
        return Promise.resolve({ data: null, error: null })
      }
      throw new Error(`unexpected rpc: ${fn}`)
    })
    vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never)
    return counts
  }

  it('enforces the provided daily limit and blocks the next reservation', async () => {
    mockCrawlQuotaRpc()
    expect((await reserveCrawlStart('u1', 2)).allowed).toBe(true)
    expect((await reserveCrawlStart('u1', 2)).allowed).toBe(true)
    const third = await reserveCrawlStart('u1', 2)
    expect(third.allowed).toBe(false)
    expect(third.blockedReason).toMatch(/Daily crawl quota reached \(2/)
  })

  it('release gives back a slot after a failed crawl start', async () => {
    mockCrawlQuotaRpc()
    expect((await reserveCrawlStart('u2', 1)).allowed).toBe(true)
    expect((await reserveCrawlStart('u2', 1)).allowed).toBe(false)
    await releaseCrawlStart('u2')
    expect((await reserveCrawlStart('u2', 1)).allowed).toBe(true)
  })

  it('holds the state in the external store the mock represents, not in any module-level counter', async () => {
    // reserveCrawlStart no longer owns any mutable counter itself — every
    // decision comes from whatever `counts` this call's RPC mock was given.
    // Two independently-provided `counts` objects for the same user are
    // never conflated, which they would be if a leftover module-level Map
    // were still consulted first.
    const countsA = mockCrawlQuotaRpc()
    expect((await reserveCrawlStart('shared-id', 1)).allowed).toBe(true)
    expect((await reserveCrawlStart('shared-id', 1)).allowed).toBe(false)

    const countsB = mockCrawlQuotaRpc({}) // fresh external store, same user id
    expect(countsB).not.toBe(countsA)
    expect((await reserveCrawlStart('shared-id', 1)).allowed).toBe(true)
  })
})

describe('product-decisions page limits', () => {
  it('ships free 25 and paid default 500', () => {
    expect(FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunFree).toBe(25)
    expect(FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunPaidDefault).toBe(500)
  })
})
