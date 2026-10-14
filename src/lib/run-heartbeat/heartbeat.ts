/**
 * Minute heartbeat: advance unfinished crawl / fix / e2e runs without relying
 * on browser tabs or in-process waitUntil timers.
 */

export const HEARTBEAT_STALE_MS = 60_000
export const WATCHDOG_NO_PROGRESS_MS = 15 * 60_000
/** Default lease for fix ticks (short mechanical steps). */
export const TICK_LEASE_MS = 55_000
/**
 * Crawl ticks (esp. SPA headless render + post-crawl) can run tens of seconds
 * under Hobby maxDuration=300. A 55s lease let the next heartbeat claim while
 * the previous tick was still writing jobs/cursors — progress stalled, then
 * the 15m watchdog failed the run. Hold the lease for almost the full
 * invocation budget so browser drain and heartbeat serialize on one tick.
 */
export const CRAWL_TICK_LEASE_MS = 280_000
/**
 * E2e ticks use a ~240s soft budget. A 55s lease let heartbeat reclaim mid-tick;
 * combined with a second claim inside tickE2eRun, wait_seed_production starved.
 */
export const E2E_TICK_LEASE_MS = 280_000

export type RunKind = 'crawl' | 'fix' | 'e2e'

export function tickLeaseMsForKind(kind: RunKind): number {
  if (kind === 'crawl') return CRAWL_TICK_LEASE_MS
  if (kind === 'e2e') return E2E_TICK_LEASE_MS
  return TICK_LEASE_MS
}

export type ScheduledRun = {
  kind: RunKind
  id: string
  userId?: string | null
  siteId?: string | null
  /** Fix-run phase; used to skip human-wait watchdog. */
  phase?: string | null
  lastProgressAt: string
  leaseUntil: string | null
}

export type HeartbeatDeps = {
  nowMs: () => number
  listUnfinished: () => Promise<ScheduledRun[]>
  /** CAS lease — false if another worker already holds the tick. */
  claimRun: (kind: RunKind, id: string, leaseUntilIso: string) => Promise<boolean>
  tickCrawl: (id: string) => Promise<{ advanced: boolean }>
  tickFix: (id: string, userId: string) => Promise<{ advanced: boolean }>
  tickE2e: (id: string) => Promise<{ advanced: boolean }>
  markProgress: (kind: RunKind, id: string, atIso: string) => Promise<void>
  failStalled: (run: ScheduledRun, reason: string) => Promise<void>
}

export type HeartbeatResult = {
  ticked: { kind: RunKind; id: string }[]
  failed: { kind: RunKind; id: string; reason: string }[]
  skipped: number
  errors: { kind: RunKind; id: string; error: string }[]
}

function isLeaseActive(run: ScheduledRun, nowMs: number): boolean {
  if (!run.leaseUntil) return false
  const until = Date.parse(run.leaseUntil)
  return Number.isFinite(until) && until > nowMs
}

function isWatchdogCandidate(run: ScheduledRun, nowMs: number): boolean {
  if (run.kind === 'fix' && run.phase === 'await_approval') return false
  const progressMs = Date.parse(run.lastProgressAt)
  if (!Number.isFinite(progressMs)) return true
  return nowMs - progressMs >= WATCHDOG_NO_PROGRESS_MS
}

const STALL_REASON = 'No progress for 15 minutes — failed by heartbeat watchdog'

export async function runHeartbeat(deps: HeartbeatDeps): Promise<HeartbeatResult> {
  const nowMs = deps.nowMs()
  const nowIso = new Date(nowMs).toISOString()

  const unfinished = await deps.listUnfinished()
  const ticked: HeartbeatResult['ticked'] = []
  const failed: HeartbeatResult['failed'] = []
  const errors: HeartbeatResult['errors'] = []
  let skipped = 0

  for (const run of unfinished) {
    // Human approval is not heartbeat-driven — leave the run alone.
    if (run.kind === 'fix' && run.phase === 'await_approval') {
      skipped += 1
      continue
    }

    if (isWatchdogCandidate(run, nowMs)) {
      const reason = STALL_REASON
      try {
        await deps.failStalled(run, reason)
        failed.push({ kind: run.kind, id: run.id, reason })
      } catch (err) {
        errors.push({
          kind: run.kind,
          id: run.id,
          error: err instanceof Error ? err.message : 'failStalled failed',
        })
      }
      continue
    }

    if (isLeaseActive(run, nowMs)) {
      skipped += 1
      continue
    }

    const leaseUntilIso = new Date(
      nowMs + tickLeaseMsForKind(run.kind),
    ).toISOString()

    let claimed = false
    try {
      claimed = await deps.claimRun(run.kind, run.id, leaseUntilIso)
    } catch (err) {
      errors.push({
        kind: run.kind,
        id: run.id,
        error: err instanceof Error ? err.message : 'claim failed',
      })
      continue
    }
    if (!claimed) {
      skipped += 1
      continue
    }

    try {
      let advanced = false
      if (run.kind === 'crawl') {
        advanced = (await deps.tickCrawl(run.id)).advanced
      } else if (run.kind === 'fix') {
        if (!run.userId) {
          skipped += 1
          continue
        }
        advanced = (await deps.tickFix(run.id, run.userId)).advanced
      } else {
        advanced = (await deps.tickE2e(run.id)).advanced
      }
      ticked.push({ kind: run.kind, id: run.id })
      if (advanced) {
        await deps.markProgress(run.kind, run.id, nowIso)
      }
    } catch (err) {
      errors.push({
        kind: run.kind,
        id: run.id,
        error: err instanceof Error ? err.message : 'tick failed',
      })
    }
  }

  return { ticked, failed, skipped, errors }
}
