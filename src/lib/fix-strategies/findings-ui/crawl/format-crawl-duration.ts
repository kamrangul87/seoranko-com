/**
 * Human-readable crawl wall-clock from startedAt → finishedAt (or now if still running).
 */
export function formatCrawlDuration(input: {
  startedAt: string | null | undefined
  finishedAt?: string | null | undefined
  /** When finishedAt is null, measure against this instant (tests / UI). */
  nowMs?: number
}): string | null {
  if (!input.startedAt) return null
  const start = Date.parse(input.startedAt)
  if (!Number.isFinite(start)) return null
  const endRaw = input.finishedAt ? Date.parse(input.finishedAt) : (input.nowMs ?? Date.now())
  if (!Number.isFinite(endRaw)) return null
  const ms = Math.max(0, endRaw - start)
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`
}
