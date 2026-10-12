import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { FixFailureStage } from './signature'

export const BREAKER_WINDOW_DAYS = 14
export const BREAKER_DISTINCT_SITES = 2
export const BREAKER_CONSECUTIVE = 2

const BREAKER_STAGES: FixFailureStage[] = [
  'apply',
  'preview_verify',
  'production_verify',
]

export type FixTypeStatusRow = {
  topic: string
  verdict: string
  state: 'active' | 'paused'
  pausedReason: string | null
  pausedAt: string | null
  failureCountWindow: number
  lastFailureAt: string | null
  resumedAt: string | null
  updatedAt: string
}

function mapRow(r: Record<string, unknown>): FixTypeStatusRow {
  return {
    topic: String(r.topic),
    verdict: String(r.verdict),
    state: r.state === 'paused' ? 'paused' : 'active',
    pausedReason: (r.paused_reason as string | null) ?? null,
    pausedAt: (r.paused_at as string | null) ?? null,
    failureCountWindow: Number(r.failure_count_window ?? 0),
    lastFailureAt: (r.last_failure_at as string | null) ?? null,
    resumedAt: (r.resumed_at as string | null) ?? null,
    updatedAt: String(r.updated_at ?? ''),
  }
}

export function fixTypeKey(topic: string, verdict: string): string {
  return `${topic}|${verdict}`
}

export async function listPausedFixTypes(): Promise<FixTypeStatusRow[]> {
  try {
    const sb = createServiceRoleClient()
    const { data, error } = await sb
      .from('fix_type_status')
      .select('*')
      .eq('state', 'paused')
      .order('paused_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
  } catch {
    return []
  }
}

export async function listAllFixTypeStatuses(): Promise<FixTypeStatusRow[]> {
  try {
    const sb = createServiceRoleClient()
    const { data, error } = await sb
      .from('fix_type_status')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
  } catch {
    return []
  }
}

export async function isFixTypePaused(
  topic: string,
  verdict: string,
): Promise<boolean> {
  try {
    const sb = createServiceRoleClient()
    const { data } = await sb
      .from('fix_type_status')
      .select('state')
      .eq('topic', topic)
      .eq('verdict', verdict)
      .maybeSingle()
    return data?.state === 'paused'
  } catch {
    return false
  }
}

export async function loadPausedFixTypeSet(): Promise<Set<string>> {
  const rows = await listPausedFixTypes()
  return new Set(rows.map((r) => fixTypeKey(r.topic, r.verdict)))
}

/** Pure evaluation used by tests + evaluateAndMaybePause. */
export function shouldPauseFixType(input: {
  distinctSiteCount: number
  consecutiveFailures: number
}): { pause: boolean; reason: string | null } {
  if (input.distinctSiteCount >= BREAKER_DISTINCT_SITES) {
    return {
      pause: true,
      reason: `Paused: apply/live-verify failures on ${input.distinctSiteCount} distinct sites within ${BREAKER_WINDOW_DAYS} days`,
    }
  }
  if (input.consecutiveFailures >= BREAKER_CONSECUTIVE) {
    return {
      pause: true,
      reason: `Paused: ${input.consecutiveFailures} consecutive apply/live-verify failures within ${BREAKER_WINDOW_DAYS} days`,
    }
  }
  return { pause: false, reason: null }
}

export async function evaluateAndMaybePause(input: {
  topic: string
  verdict: string
  stage: FixFailureStage
  siteId: string | null
}): Promise<{ paused: boolean; reason: string | null }> {
  if (!BREAKER_STAGES.includes(input.stage)) {
    return { paused: false, reason: null }
  }
  try {
    const sb = createServiceRoleClient()
    const since = new Date(
      Date.now() - BREAKER_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()
    const { data: failures, error } = await sb
      .from('fix_failures')
      .select('site_id, stage, created_at')
      .eq('topic', input.topic)
      .eq('verdict', input.verdict)
      .in('stage', BREAKER_STAGES)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)

    const rows = failures ?? []
    const sites = new Set(
      rows
        .map((r) => r.site_id as string | null)
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
    )
    // Consecutive: most-recent streak of breaker-stage failures (any site).
    let consecutive = 0
    for (const r of rows) {
      if (BREAKER_STAGES.includes(r.stage as FixFailureStage)) consecutive += 1
      else break
    }

    const decision = shouldPauseFixType({
      distinctSiteCount: sites.size,
      consecutiveFailures: consecutive,
    })

    const now = new Date().toISOString()
    if (decision.pause) {
      await sb.from('fix_type_status').upsert(
        {
          topic: input.topic,
          verdict: input.verdict,
          state: 'paused',
          paused_reason: decision.reason,
          paused_at: now,
          failure_count_window: rows.length,
          last_failure_at: now,
          updated_at: now,
        },
        { onConflict: 'topic,verdict' },
      )
      return { paused: true, reason: decision.reason }
    }

    await sb.from('fix_type_status').upsert(
      {
        topic: input.topic,
        verdict: input.verdict,
        state: 'active',
        failure_count_window: rows.length,
        last_failure_at: now,
        updated_at: now,
      },
      { onConflict: 'topic,verdict' },
    )
    return { paused: false, reason: null }
  } catch (e) {
    console.info(
      '[fix-failure] evaluateAndMaybePause',
      e instanceof Error ? e.message : e,
    )
    return { paused: false, reason: null }
  }
}

export async function e2ePassedSince(pausedAt: string): Promise<boolean> {
  try {
    const sb = createServiceRoleClient()
    const { data, error } = await sb
      .from('e2e_runs')
      .select('status, finished_at')
      .eq('kind', 'fix_agent_fixture')
      .eq('status', 'passed')
      .gt('finished_at', pausedAt)
      .limit(1)
    if (error) return false
    return (data ?? []).length > 0
  } catch {
    return false
  }
}

export type ResumeResult =
  | { ok: true }
  | { ok: false; error: string; status: number }

export async function resumeFixType(input: {
  topic: string
  verdict: string
}): Promise<ResumeResult> {
  try {
    const sb = createServiceRoleClient()
    const { data, error } = await sb
      .from('fix_type_status')
      .select('*')
      .eq('topic', input.topic)
      .eq('verdict', input.verdict)
      .maybeSingle()
    if (error) return { ok: false, error: error.message, status: 500 }
    if (!data || data.state !== 'paused') {
      return { ok: false, error: 'Fix type is not paused', status: 400 }
    }
    const pausedAt = data.paused_at as string | null
    if (!pausedAt) {
      return { ok: false, error: 'Missing paused_at', status: 400 }
    }
    const passed = await e2ePassedSince(pausedAt)
    if (!passed) {
      return {
        ok: false,
        error:
          'Resume blocked — Fix Agent e2e must pass after the pause before resume',
        status: 409,
      }
    }
    const now = new Date().toISOString()
    const { error: updErr } = await sb
      .from('fix_type_status')
      .update({
        state: 'active',
        paused_reason: null,
        resumed_at: now,
        updated_at: now,
      })
      .eq('topic', input.topic)
      .eq('verdict', input.verdict)
    if (updErr) return { ok: false, error: updErr.message, status: 500 }
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Resume failed',
      status: 500,
    }
  }
}
