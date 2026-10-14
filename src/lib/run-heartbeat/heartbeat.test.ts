/**
 * Heartbeat + watchdog — progress without browser tabs or in-process timers.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  HEARTBEAT_STALE_MS,
  WATCHDOG_NO_PROGRESS_MS,
  TICK_LEASE_MS,
  CRAWL_TICK_LEASE_MS,
  E2E_TICK_LEASE_MS,
  tickLeaseMsForKind,
  runHeartbeat,
  type HeartbeatDeps,
  type ScheduledRun,
} from './heartbeat'

function baseRun(partial: Partial<ScheduledRun> & Pick<ScheduledRun, 'kind' | 'id'>): ScheduledRun {
  const now = Date.now()
  return {
    userId: 'user-1',
    siteId: 'site-1',
    phase: partial.kind === 'fix' ? 'apply_next' : null,
    lastProgressAt: new Date(now - 90_000).toISOString(),
    leaseUntil: null,
    ...partial,
  }
}

function makeDeps(overrides: Partial<HeartbeatDeps> = {}): HeartbeatDeps & {
  ticks: { kind: string; id: string }[]
  fails: { kind: string; id: string; reason: string }[]
  claims: string[]
} {
  const ticks: { kind: string; id: string }[] = []
  const fails: { kind: string; id: string; reason: string }[] = []
  const claims: string[] = []
  const claimed = new Set<string>()

  const deps: HeartbeatDeps & {
    ticks: typeof ticks
    fails: typeof fails
    claims: typeof claims
  } = {
    ticks,
    fails,
    claims,
    nowMs: () => Date.now(),
    listUnfinished: async () => [],
    claimRun: async (kind, id) => {
      const key = `${kind}:${id}`
      claims.push(key)
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    },
    tickCrawl: async (id) => {
      ticks.push({ kind: 'crawl', id })
      return { advanced: true }
    },
    tickFix: async (id) => {
      ticks.push({ kind: 'fix', id })
      return { advanced: true }
    },
    tickE2e: async (id) => {
      ticks.push({ kind: 'e2e', id })
      return { advanced: true }
    },
    markProgress: async () => {},
    failStalled: async (run, reason) => {
      fails.push({ kind: run.kind, id: run.id, reason })
    },
    ...overrides,
  }
  return deps
}

describe('runHeartbeat', () => {
  it('drives an unfinished e2e run with heartbeat ticks alone (no browser / self-schedule)', async () => {
    const run = baseRun({ kind: 'e2e', id: 'e2e-1' })
    let advancedCount = 0
    const deps = makeDeps({
      listUnfinished: async () => [run],
      tickE2e: async (id) => {
        advancedCount += 1
        deps.ticks.push({ kind: 'e2e', id })
        return { advanced: true }
      },
    })

    const first = await runHeartbeat(deps)
    expect(first.ticked).toEqual([{ kind: 'e2e', id: 'e2e-1' }])
    expect(advancedCount).toBe(1)

    // Simulate lease expiry + another minute — second heartbeat advances again.
    const deps2 = makeDeps({
      listUnfinished: async () => [run],
      tickE2e: async () => {
        advancedCount += 1
        return { advanced: true }
      },
    })
    await runHeartbeat(deps2)
    expect(advancedCount).toBe(2)
  })

  it('concurrent heartbeat claims do not double-apply the same run', async () => {
    const run = baseRun({ kind: 'fix', id: 'fix-1', phase: 'apply_next' })
    let claimCount = 0
    const claim = async () => {
      claimCount += 1
      return claimCount === 1
    }
    const tickFix = vi.fn(async () => ({ advanced: true }))

    const sharedList = async () => [run]
    const a = makeDeps({ listUnfinished: sharedList, claimRun: claim, tickFix })
    const b = makeDeps({ listUnfinished: sharedList, claimRun: claim, tickFix })

    const [ra, rb] = await Promise.all([runHeartbeat(a), runHeartbeat(b)])
    const tickTotal =
      ra.ticked.filter((t) => t.id === 'fix-1').length +
      rb.ticked.filter((t) => t.id === 'fix-1').length
    expect(tickTotal).toBe(1)
    expect(tickFix).toHaveBeenCalledTimes(1)
  })

  it('watchdog fails a frozen run with no progress for 15 minutes', async () => {
    const frozen = baseRun({
      kind: 'fix',
      id: 'fix-frozen',
      phase: 'apply_next',
      lastProgressAt: new Date(Date.now() - WATCHDOG_NO_PROGRESS_MS - 1_000).toISOString(),
    })
    const deps = makeDeps({
      listUnfinished: async () => [frozen],
      tickFix: async () => {
        throw new Error('should not tick a watchdog-failed run')
      },
    })

    const result = await runHeartbeat(deps)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({
      kind: 'fix',
      id: 'fix-frozen',
    })
    expect(result.failed[0]?.reason).toMatch(/no progress for 15 minutes/i)
    expect(result.ticked).toHaveLength(0)
    expect(deps.fails).toHaveLength(1)
  })

  it('skips runs still within the 60s tick window', async () => {
    const fresh = baseRun({
      kind: 'crawl',
      id: 'crawl-1',
      leaseUntil: new Date(Date.now() + 30_000).toISOString(),
      lastProgressAt: new Date().toISOString(),
    })
    const deps = makeDeps({
      listUnfinished: async () => [fresh],
    })
    const result = await runHeartbeat(deps)
    expect(result.ticked).toHaveLength(0)
    expect(result.skipped).toBeGreaterThanOrEqual(1)
  })

  it('does not watchdog-fail await_approval (human wait)', async () => {
    const waiting = baseRun({
      kind: 'fix',
      id: 'fix-wait',
      phase: 'await_approval',
      lastProgressAt: new Date(Date.now() - WATCHDOG_NO_PROGRESS_MS - 60_000).toISOString(),
    })
    const deps = makeDeps({
      listUnfinished: async () => [waiting],
    })
    const result = await runHeartbeat(deps)
    expect(result.failed).toHaveLength(0)
    expect(result.ticked).toHaveLength(0)
  })

  it('exports stale threshold of 60s', () => {
    expect(HEARTBEAT_STALE_MS).toBe(60_000)
  })

  it('uses a long crawl lease under Hobby 300s (SPA / post-crawl safe)', () => {
    expect(CRAWL_TICK_LEASE_MS).toBe(280_000)
    expect(CRAWL_TICK_LEASE_MS).toBeGreaterThan(TICK_LEASE_MS)
    expect(CRAWL_TICK_LEASE_MS).toBeLessThan(300_000)
    expect(tickLeaseMsForKind('crawl')).toBe(CRAWL_TICK_LEASE_MS)
    expect(tickLeaseMsForKind('fix')).toBe(TICK_LEASE_MS)
    expect(tickLeaseMsForKind('e2e')).toBe(E2E_TICK_LEASE_MS)
    expect(E2E_TICK_LEASE_MS).toBe(280_000)
  })

  it('drives an unfinished crawl with heartbeat ticks alone (SPA multi-tick)', async () => {
    const run = baseRun({ kind: 'crawl', id: 'crawl-spa-1' })
    let remaining = 6 // 3 ticks × 2 render-chunk URLs
    const deps = makeDeps({
      listUnfinished: async () =>
        remaining > 0
          ? [
              {
                ...run,
                lastProgressAt: new Date(Date.now() - 90_000).toISOString(),
                leaseUntil: null,
              },
            ]
          : [],
      tickCrawl: async (id) => {
        deps.ticks.push({ kind: 'crawl', id })
        remaining = Math.max(0, remaining - 2)
        return { advanced: true }
      },
      claimRun: async (_kind, id, leaseUntilIso) => {
        deps.claims.push(`${id}:${leaseUntilIso}`)
        // Lease must cover near-full Hobby budget so a concurrent heartbeat
        // cannot steal mid headless render.
        const until = Date.parse(leaseUntilIso)
        expect(until - Date.now()).toBeGreaterThan(200_000)
        return true
      },
    })

    let ticks = 0
    while (remaining > 0 && ticks < 10) {
      ticks += 1
      await runHeartbeat(deps)
    }
    expect(remaining).toBe(0)
    expect(deps.ticks.filter((t) => t.kind === 'crawl')).toHaveLength(3)
  })

  it('marks post-crawl-only ticks as progress (not watchdog food)', async () => {
    // Simulated via deps: tickCrawl reports advanced=true when phase moves
    // with processedThisTick=0 — covered in supabase-deps wiring; here we
    // assert the heartbeat still markProgresses when advanced.
    const run = baseRun({ kind: 'crawl', id: 'crawl-post-1' })
    const progress: string[] = []
    const deps = makeDeps({
      listUnfinished: async () => [run],
      tickCrawl: async () => ({ advanced: true }), // post-crawl phase moved
      markProgress: async (_k, id, at) => {
        progress.push(`${id}:${at}`)
      },
    })
    await runHeartbeat(deps)
    expect(progress).toHaveLength(1)
    expect(progress[0]).toMatch(/^crawl-post-1:/)
  })
})
