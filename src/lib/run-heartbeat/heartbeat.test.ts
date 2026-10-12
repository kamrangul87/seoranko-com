/**
 * Heartbeat + watchdog — progress without browser tabs or in-process timers.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  HEARTBEAT_STALE_MS,
  WATCHDOG_NO_PROGRESS_MS,
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
})
