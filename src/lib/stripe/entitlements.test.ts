import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertFixWriteEntitled,
  crawlDailyLimitForUser,
  isMasterUserEmail,
} from '@/lib/stripe/entitlements'
import {
  __resetCrawlRateLimitForTests,
  assertCrawlStartAllowed,
  recordCrawlStart,
} from '@/lib/fix-strategies/findings-ui/crawl/rate-limit'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service-role'

function mockSubscriptionStatus(status: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: status ? { status } : null,
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

  it('matches MASTER_EMAIL case-insensitively', () => {
    process.env.MASTER_EMAIL = 'Owner@Example.com'
    expect(isMasterUserEmail('owner@example.com')).toBe(true)
    expect(isMasterUserEmail('other@example.com')).toBe(false)
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
    mockSubscriptionStatus('active')
    const result = await assertFixWriteEntitled({ userId: 'u1', email: 'a@b.co' })
    expect(result).toEqual({ ok: true, reason: 'subscription' })
  })

  it('denies free users with 402 + billing path', async () => {
    mockSubscriptionStatus(null)
    const result = await assertFixWriteEntitled({ userId: 'u1', email: 'a@b.co' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(402)
      expect(result.code).toBe('SUBSCRIPTION_REQUIRED')
      expect(result.billingPath).toBe('/dashboard/billing')
    }
  })
})

describe('crawlDailyLimitForUser', () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.MASTER_EMAIL
  })

  it('returns free tier by default', async () => {
    mockSubscriptionStatus(null)
    await expect(
      crawlDailyLimitForUser({ userId: 'u1', email: 'a@b.co' }),
    ).resolves.toBe(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDayFree)
  })

  it('returns subscribed tier for active plans and master', async () => {
    mockSubscriptionStatus('trialing')
    await expect(
      crawlDailyLimitForUser({ userId: 'u1', email: 'a@b.co' }),
    ).resolves.toBe(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDaySubscribed)

    process.env.MASTER_EMAIL = 'owner@example.com'
    await expect(
      crawlDailyLimitForUser({ userId: 'u1', email: 'owner@example.com' }),
    ).resolves.toBe(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDaySubscribed)
  })
})

describe('assertCrawlStartAllowed with explicit limit', () => {
  beforeEach(() => {
    __resetCrawlRateLimitForTests()
  })

  it('enforces the provided daily limit', () => {
    expect(assertCrawlStartAllowed('u1', 2)).toBeNull()
    recordCrawlStart('u1')
    expect(assertCrawlStartAllowed('u1', 2)).toBeNull()
    recordCrawlStart('u1')
    expect(assertCrawlStartAllowed('u1', 2)).toMatch(/Daily crawl quota reached \(2/)
  })
})
