import { describe, expect, it } from 'vitest'
import {
  CRAWL_STATUS_POLL_MS,
  CRAWL_WATCHDOG_MS,
  crawlProgressKind,
  crawlProgressLabel,
  shouldShowEngineeringCrawlChips,
} from './crawl-progress-ui'
import {
  CRAWL_TICK_DEADLINE_MS,
  CRAWL_STEP_TIMEOUT_MS,
} from './constants'
import { CRAWL_TICK_LEASE_MS } from '@/lib/run-heartbeat/heartbeat'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

describe('crawl tick budget + lease (Hobby-safe)', () => {
  it('soft tick budget is ~240s and under Hobby maxDuration', () => {
    expect(CRAWL_TICK_DEADLINE_MS).toBe(240_000)
    expect(CRAWL_TICK_DEADLINE_MS).toBeLessThan(300_000)
  })

  it('lease is under 300s and above soft budget so finally-release is the normal path', () => {
    expect(CRAWL_TICK_LEASE_MS).toBeLessThan(300_000)
    expect(CRAWL_TICK_LEASE_MS).toBeGreaterThan(CRAWL_TICK_DEADLINE_MS)
  })

  it('per-step timeout covers first render + 15s retry', () => {
    const renderBudget =
      FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderTimeoutMs +
      FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderRetryTimeoutMs
    expect(CRAWL_STEP_TIMEOUT_MS).toBeGreaterThan(renderBudget)
  })
})

describe('crawl status poll', () => {
  it('polls every 5 seconds while a crawl is running', () => {
    expect(CRAWL_STATUS_POLL_MS).toBe(5_000)
  })
})

describe('crawlProgressKind / label', () => {
  it('shows Still working while queued/running — not stalled before watchdog', () => {
    expect(crawlProgressKind({ status: 'running' })).toBe('still_working')
    expect(crawlProgressKind({ status: 'queued' })).toBe('still_working')
    expect(crawlProgressLabel({ status: 'running' })).toBe('Still working…')
    expect(CRAWL_WATCHDOG_MS).toBe(15 * 60_000)
  })

  it('shows Crawl stalled only after watchdog fails the run', () => {
    expect(
      crawlProgressKind({
        status: 'failed',
        errorDetail: 'No progress for 15 minutes — failed by heartbeat watchdog',
      }),
    ).toBe('stalled')
    expect(
      crawlProgressLabel({
        status: 'failed',
        errorDetail: 'No progress for 15 minutes — failed by heartbeat watchdog',
      }),
    ).toBe('Crawl stalled')
  })

  it('does not treat other failures as stall banner', () => {
    expect(
      crawlProgressKind({
        status: 'failed',
        errorDetail: 'Abandoned — no tick for 30+ minutes',
      }),
    ).toBe('normal')
    expect(
      crawlProgressLabel({
        status: 'failed',
        errorDetail: 'Abandoned — no tick for 30+ minutes',
      }),
    ).toBe('Failed')
  })
})

describe('shouldShowEngineeringCrawlChips', () => {
  it('hides Cap / Chunk / rendered / internal from non-master', () => {
    expect(shouldShowEngineeringCrawlChips(false)).toBe(false)
    expect(shouldShowEngineeringCrawlChips(undefined)).toBe(false)
    expect(shouldShowEngineeringCrawlChips(null)).toBe(false)
  })

  it('shows engineering chips for master (canRunFixAgent)', () => {
    expect(shouldShowEngineeringCrawlChips(true)).toBe(true)
  })
})
