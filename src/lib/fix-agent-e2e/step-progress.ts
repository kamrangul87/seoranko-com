import { E2E_STEP_ORDER, type E2eStepName } from './constants'
import type { E2eStepRecord } from './store'

/** Higher means more advanced — never replace a higher rank with a lower one. */
export function stepStatusRank(
  status: E2eStepRecord['status'] | undefined,
): number {
  switch (status) {
    case 'failed':
      return 4
    case 'passed':
    case 'skipped':
      return 3
    case 'running':
      return 2
    case 'pending':
    default:
      return 1
  }
}

/** Highest step index that is no longer pending (running/passed/failed/skipped). */
export function maxReachedStepIndex(steps: E2eStepRecord[]): number {
  let max = -1
  for (const s of steps) {
    if (stepStatusRank(s.status) <= 1) continue
    const i = E2E_STEP_ORDER.indexOf(s.name as E2eStepName)
    if (i > max) max = i
  }
  return max
}

/**
 * Merge a proposed steps array onto the latest row without rewinding progress.
 * Per-step: keep the higher-ranked status; when ranks tie, prefer proposed
 * (so detail/finishedAt updates on the active step still land).
 */
export function mergeStepsNoRewind(
  latest: E2eStepRecord[],
  proposed: E2eStepRecord[],
): E2eStepRecord[] {
  const byName = new Map(proposed.map((s) => [s.name, s]))
  const names = new Set([
    ...latest.map((s) => s.name),
    ...proposed.map((s) => s.name),
  ])
  const merged: E2eStepRecord[] = []
  for (const name of E2E_STEP_ORDER) {
    if (!names.has(name)) continue
    const live = latest.find((s) => s.name === name)
    const next = byName.get(name)
    if (!live) {
      if (next) merged.push(next)
      continue
    }
    if (!next) {
      merged.push(live)
      continue
    }
    const liveRank = stepStatusRank(live.status)
    const nextRank = stepStatusRank(next.status)
    if (nextRank > liveRank) {
      merged.push(next)
    } else if (nextRank < liveRank) {
      merged.push(live)
    } else {
      // Same rank — prefer proposed fields but never drop startedAt/finishedAt.
      merged.push({
        ...live,
        ...next,
        startedAt: next.startedAt ?? live.startedAt,
        finishedAt: next.finishedAt ?? live.finishedAt,
      })
    }
  }
  // Preserve any unknown step names after the ordered ones.
  for (const s of latest) {
    if (!E2E_STEP_ORDER.includes(s.name as E2eStepName)) merged.push(s)
  }
  return merged
}

/** True if writing `proposed` would lose progress already on `latest`. */
export function wouldRewindSteps(
  latest: E2eStepRecord[],
  proposed: E2eStepRecord[],
): boolean {
  return maxReachedStepIndex(proposed) < maxReachedStepIndex(latest)
}
