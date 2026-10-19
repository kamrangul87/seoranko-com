/**
 * Clear tick_lease_until so the next heartbeat / browser drain can claim
 * immediately after a tick finishes (including finally after errors).
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { RunKind } from './heartbeat'

export async function releaseTickLease(
  kind: RunKind,
  id: string,
): Promise<boolean> {
  const sb = createServiceRoleClient()
  const { data, error } = await sb.rpc('release_run_tick', {
    p_kind: kind,
    p_id: id,
  })
  if (error) {
    console.error('[heartbeat] releaseTickLease', kind, id, error.message)
    return false
  }
  return data === true
}
