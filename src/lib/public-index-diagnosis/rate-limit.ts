/**
 * In-process concurrency + hourly rate limit for public scans.
 * DB-backed when public_scans exists; in-memory fallback so launch-day
 * rate limits still work if the table is briefly missing.
 */

import { createClient } from '@supabase/supabase-js'

export const PUBLIC_SCAN_RATE_LIMIT_PER_HOUR = 1

/** Hard crawl budget for the public funnel (containment — not a product expansion). */
export const PUBLIC_SCAN_MAX_DISCOVERED = 40
export const PUBLIC_SCAN_MAX_FETCHED = 40
export const PUBLIC_SCAN_MAX_DEPTH = 4
export const PUBLIC_SCAN_DEADLINE_MS = 25_000

const concurrentByIp = new Set<string>()
const memoryHits = new Map<string, number[]>()

export function tryAcquireScanLock(ipHash: string): boolean {
  if (concurrentByIp.has(ipHash)) return false
  concurrentByIp.add(ipHash)
  return true
}

export function releaseScanLock(ipHash: string): void {
  concurrentByIp.delete(ipHash)
}

function pruneMemory(ipHash: string, now = Date.now()): number {
  const windowStart = now - 60 * 60 * 1000
  const prev = memoryHits.get(ipHash) || []
  const next = prev.filter((t) => t >= windowStart)
  memoryHits.set(ipHash, next)
  return next.length
}

/** Record a completed attempt toward the hourly cap (success or persisted). */
export function recordMemoryScan(ipHash: string): void {
  const now = Date.now()
  pruneMemory(ipHash, now)
  const list = memoryHits.get(ipHash) || []
  list.push(now)
  memoryHits.set(ipHash, list)
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function countScansLastHour(ipHash: string): Promise<number> {
  const mem = pruneMemory(ipHash)
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error } = await serviceClient()
      .from('public_scans')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('scanned_at', since)
    if (error) {
      console.warn('[public-scan] rate count failed', error.message)
      return mem
    }
    return Math.max(count ?? 0, mem)
  } catch (err) {
    console.warn('[public-scan] rate count error', err)
    return mem
  }
}
