/**
 * Bump last_progress_at so the heartbeat watchdog does not false-fail runs
 * that advanced via browser or in-process continue ticks.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { RunKind } from './heartbeat'

function tableFor(kind: RunKind): string {
  if (kind === 'crawl') return 'fix_strategies_crawl_runs'
  if (kind === 'fix') return 'fix_strategies_runs'
  return 'e2e_runs'
}

export async function touchLastProgress(
  kind: RunKind,
  id: string,
  atIso: string = new Date().toISOString(),
): Promise<void> {
  try {
    const sb = createServiceRoleClient()
    const { error } = await sb
      .from(tableFor(kind))
      .update({ last_progress_at: atIso })
      .eq('id', id)
    if (error) {
      console.error('[heartbeat] touchLastProgress', kind, id, error.message)
    }
  } catch (err) {
    console.error('[heartbeat] touchLastProgress', kind, id, err)
  }
}
