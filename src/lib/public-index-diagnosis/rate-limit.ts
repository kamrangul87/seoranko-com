/**
 * In-process concurrency + DB-backed hourly rate limit for public scans.
 */

import { createClient } from '@supabase/supabase-js'

const concurrentByIp = new Set<string>()

export function tryAcquireScanLock(ipHash: string): boolean {
  if (concurrentByIp.has(ipHash)) return false
  concurrentByIp.add(ipHash)
  return true
}

export function releaseScanLock(ipHash: string): void {
  concurrentByIp.delete(ipHash)
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function countScansLastHour(ipHash: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error } = await serviceClient()
      .from('public_scans')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('scanned_at', since)
    if (error) {
      console.warn('[public-scan] rate count failed', error.message)
      return 0
    }
    return count ?? 0
  } catch (err) {
    console.warn('[public-scan] rate count error', err)
    return 0
  }
}

export const PUBLIC_SCAN_RATE_LIMIT_PER_HOUR = 3
