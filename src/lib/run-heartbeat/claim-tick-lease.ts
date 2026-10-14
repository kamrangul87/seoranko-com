/**
 * CAS tick lease shared by heartbeat and the crawl API so browser drain and
 * pg_cron never run processCrawlTick concurrently on the same run.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  CRAWL_TICK_LEASE_MS,
  tickLeaseMsForKind,
  type RunKind,
} from './heartbeat'

export async function claimTickLease(
  kind: RunKind,
  id: string,
  leaseMs?: number,
): Promise<boolean> {
  const ms = leaseMs ?? tickLeaseMsForKind(kind)
  const leaseUntilIso = new Date(Date.now() + ms).toISOString()
  const sb = createServiceRoleClient()
  const { data, error } = await sb.rpc('claim_run_tick', {
    p_kind: kind,
    p_id: id,
    p_lease_until: leaseUntilIso,
  })
  if (error) {
    console.error('[heartbeat] claimTickLease', kind, id, error.message)
    return false
  }
  return data === true
}

export { CRAWL_TICK_LEASE_MS }
