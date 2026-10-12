/**
 * Minute heartbeat: advance unfinished crawl / fix / e2e runs without relying
 * on browser tabs or in-process waitUntil timers.
 */

export const HEARTBEAT_STALE_MS = 60_000
export const WATCHDOG_NO_PROGRESS_MS = 15 * 60_000
export const TICK_LEASE_MS = 55_000

export type RunKind = 'crawl' | 'fix' | 'e2e'

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
  const leaseUntilIso = new Date(nowMs + TICK_LEASE_MS).toISOString()

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
