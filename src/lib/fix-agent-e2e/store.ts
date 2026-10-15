import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { E2eStepName } from './constants'
import {
  maxReachedStepIndex,
  prepareForwardOnlyE2eWrite,
  stepStatusRank,
  wouldRewindCurrentStep,
} from './step-progress'

export type E2eStepRecord = {
  name: E2eStepName
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  startedAt?: string
  finishedAt?: string
  detail?: string
  error?: string
}

export type E2eRunRow = {
  id: string
  kind: string
  status: 'running' | 'passed' | 'failed'
  current_step: string | null
  steps: E2eStepRecord[]
  first_failing_step: string | null
  fail_reason: string | null
  site_id: string | null
  fix_run_id: string | null
  crawl_run_id: string | null
  seed_sha: string | null
  merge_sha: string | null
  consecutive_pass_days: number | null
  started_at: string
  finished_at: string | null
  created_at: string
  updated_at: string
  /** Monotonic CAS token; preferred over updated_at for compare-and-swap. */
  write_version?: number
}

/**
 * Next.js App Router caches `fetch` GETs by default. Supabase-js uses fetch,
 * so CAS retries would keep reading a stale write_version (always 0) after the
 * first successful write in the same invocation — see e2e 8108f0dd / 269047f9.
 */
function noStoreFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: 'no-store',
  })
}

function sb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service role not configured')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  })
}

/** Coerce PostgREST bigint (number | string) to a finite integer. */
export function parseWriteVersion(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export async function createE2eRun(input: {
  siteId: string
  steps: E2eStepRecord[]
}): Promise<E2eRunRow> {
  const client = sb()
  const { data, error } = await client
    .from('e2e_runs')
    .insert({
      kind: 'fix_agent_fixture',
      status: 'running',
      current_step: input.steps[0]?.name ?? null,
      steps: input.steps,
      site_id: input.siteId,
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'e2e_runs insert failed')
  return data as E2eRunRow
}

export async function getE2eRun(id: string): Promise<E2eRunRow | null> {
  const { data, error } = await sb()
    .from('e2e_runs')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as E2eRunRow) || null
}

const E2E_STEPS_CAS_ATTEMPTS = 8

export type E2eRunUpdatePatch = Partial<{
  status: E2eRunRow['status']
  current_step: string | null
  steps: E2eStepRecord[]
  first_failing_step: string | null
  fail_reason: string | null
  fix_run_id: string | null
  crawl_run_id: string | null
  seed_sha: string | null
  merge_sha: string | null
  consecutive_pass_days: number | null
  finished_at: string | null
}>

/**
 * True when live already has every forward field the patch wants — so a CAS
 * miss after a concurrent successful write is still a success (idempotent).
 */
export function liveSatisfiesForwardPatch(
  live: Pick<
    E2eRunRow,
    'status' | 'current_step' | 'steps' | 'seed_sha' | 'merge_sha' | 'fix_run_id' | 'crawl_run_id' | 'finished_at' | 'fail_reason' | 'first_failing_step' | 'consecutive_pass_days'
  >,
  patch: E2eRunUpdatePatch,
): boolean {
  if (patch.status !== undefined && live.status !== patch.status) return false
  if (patch.seed_sha !== undefined && live.seed_sha !== patch.seed_sha) return false
  if (patch.merge_sha !== undefined && live.merge_sha !== patch.merge_sha) return false
  if (patch.fix_run_id !== undefined && live.fix_run_id !== patch.fix_run_id) {
    return false
  }
  if (
    patch.crawl_run_id !== undefined &&
    live.crawl_run_id !== patch.crawl_run_id
  ) {
    return false
  }
  if (
    patch.finished_at !== undefined &&
    live.finished_at !== patch.finished_at
  ) {
    return false
  }
  if (
    patch.fail_reason !== undefined &&
    live.fail_reason !== patch.fail_reason
  ) {
    return false
  }
  if (
    patch.first_failing_step !== undefined &&
    live.first_failing_step !== patch.first_failing_step
  ) {
    return false
  }
  if (
    patch.consecutive_pass_days !== undefined &&
    live.consecutive_pass_days !== patch.consecutive_pass_days
  ) {
    return false
  }

  if (patch.current_step !== undefined) {
    // Satisfied when live equals proposed, or live is already ahead (no rewind).
    if (
      live.current_step !== patch.current_step &&
      !wouldRewindCurrentStep(live.current_step, patch.current_step)
    ) {
      return false
    }
  }

  if (patch.steps !== undefined) {
    const liveMax = maxReachedStepIndex(live.steps ?? [])
    const wantMax = maxReachedStepIndex(patch.steps)
    if (liveMax < wantMax) return false
    for (const want of patch.steps) {
      const cur = (live.steps ?? []).find((s) => s.name === want.name)
      if (!cur) return false
      if (stepStatusRank(cur.status) < stepStatusRank(want.status)) return false
    }
  }

  return true
}

/**
 * Sole writer for e2e_runs.steps / current_step (compare-and-swap).
 * Heartbeat and ticks must call this — never update steps directly.
 * Forward-only: rejects passed→pending and current_step rewinds (logged).
 * CAS uses write_version (integer); falls back to updated_at only if the
 * column is missing (pre-migration). Retries on conflict; if live already
 * satisfies the forward patch, returns success without rewriting.
 */
export async function updateE2eRun(
  id: string,
  patch: E2eRunUpdatePatch,
): Promise<E2eRunRow> {
  const client = sb()
  let lastErr = 'e2e_runs update failed'

  for (let attempt = 0; attempt < E2E_STEPS_CAS_ATTEMPTS; attempt++) {
    const { data: live, error: liveErr } = await client
      .from('e2e_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (liveErr) throw new Error(liveErr.message)
    if (!live) throw new Error(`e2e_runs ${id} not found`)

    const liveRow = live as E2eRunRow
    const liveSteps = liveRow.steps ?? []
    const liveCurrent =
      typeof liveRow.current_step === 'string' ? liveRow.current_step : null
    const liveVersion = parseWriteVersion(liveRow.write_version)
    const liveUpdatedAt = String(liveRow.updated_at)

    const nextPatch: Record<string, unknown> = { ...patch }
    if (patch.steps !== undefined || patch.current_step !== undefined) {
      const prepared = prepareForwardOnlyE2eWrite({
        liveSteps,
        liveCurrentStep: liveCurrent,
        proposedSteps: patch.steps,
        proposedCurrentStep: patch.current_step,
      })
      for (const reason of prepared.rejected) {
        console.warn(`[e2e_runs] rejected write run=${id} reason=${reason}`)
      }
      if (patch.steps !== undefined) {
        nextPatch.steps = prepared.steps ?? liveSteps
      }
      if (patch.current_step !== undefined) {
        if (prepared.currentStep === undefined) {
          delete nextPatch.current_step
        } else {
          nextPatch.current_step = prepared.currentStep
        }
      }
    }

    // After forward-only merge, if live already matches what we would write,
    // treat as success (another writer landed the same forward progress).
    const effectivePatch: E2eRunUpdatePatch = {
      ...patch,
      ...(nextPatch.steps !== undefined
        ? { steps: nextPatch.steps as E2eStepRecord[] }
        : {}),
      ...(nextPatch.current_step !== undefined ||
      (patch.current_step !== undefined && !('current_step' in nextPatch))
        ? 'current_step' in nextPatch
          ? { current_step: nextPatch.current_step as string | null }
          : { current_step: liveCurrent }
        : {}),
    }
    if (liveSatisfiesForwardPatch(liveRow, effectivePatch)) {
      if (attempt > 0) {
        console.warn(
          `[e2e_runs] rejected write run=${id} reason=cas_conflict_but_live_satisfies attempt=${attempt + 1}`,
        )
      }
      return liveRow
    }

    const nowIso = new Date().toISOString()
    const writeBody: Record<string, unknown> = {
      ...nextPatch,
      updated_at: nowIso,
    }
    if (liveVersion !== null) {
      writeBody.write_version = liveVersion + 1
    }

    let query = client.from('e2e_runs').update(writeBody).eq('id', id)
    if (liveVersion !== null) {
      query = query.eq('write_version', liveVersion)
    } else {
      // Pre-migration fallback — fragile; prefer write_version once migrated.
      query = query.eq('updated_at', liveUpdatedAt)
    }

    const { data, error } = await query.select('*').maybeSingle()

    if (error) {
      console.warn(
        `[e2e_runs] rejected write run=${id} reason=db_error attempt=${attempt + 1} error=${error.message}`,
      )
      lastErr = error.message
      continue
    }
    if (data) return data as E2eRunRow

    console.warn(
      `[e2e_runs] rejected write run=${id} reason=cas_conflict attempt=${attempt + 1} cas=${
        liveVersion !== null ? `write_version=${liveVersion}` : `updated_at=${liveUpdatedAt}`
      }`,
    )
    lastErr = `e2e_runs CAS conflict on ${id} (attempt ${attempt + 1})`
  }

  console.warn(
    `[e2e_runs] rejected write run=${id} reason=cas_exhausted attempts=${E2E_STEPS_CAS_ATTEMPTS} last=${lastErr}`,
  )
  throw new Error(lastErr)
}

export async function listRecentE2eRuns(limit = 20): Promise<E2eRunRow[]> {
  const { data, error } = await sb()
    .from('e2e_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data || []) as E2eRunRow[]
}

/** Count consecutive calendar days (UTC) with a passed run, ending today or yesterday. */
export async function consecutivePassingE2eDays(): Promise<number> {
  const { data, error } = await sb()
    .from('e2e_runs')
    .select('status, finished_at, started_at')
    .eq('kind', 'fix_agent_fixture')
    .order('started_at', { ascending: false })
    .limit(90)
  if (error) throw new Error(error.message)
  const rows = data || []
  const passDays = new Set<string>()
  for (const r of rows) {
    if (r.status !== 'passed') continue
    const d = (r.finished_at || r.started_at || '').slice(0, 10)
    if (d) passDays.add(d)
  }
  if (passDays.size === 0) return 0
  const today = new Date()
  let cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  // Allow streak to start from today or yesterday
  const todayKey = cursor.toISOString().slice(0, 10)
  const y = new Date(cursor)
  y.setUTCDate(y.getUTCDate() - 1)
  const yKey = y.toISOString().slice(0, 10)
  if (!passDays.has(todayKey) && !passDays.has(yKey)) return 0
  if (!passDays.has(todayKey)) cursor = y
  let n = 0
  while (passDays.has(cursor.toISOString().slice(0, 10))) {
    n += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return n
}

export async function getActiveE2eRun(): Promise<E2eRunRow | null> {
  const { data, error } = await sb()
    .from('e2e_runs')
    .select('*')
    .eq('status', 'running')
    .eq('kind', 'fix_agent_fixture')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as E2eRunRow) || null
}

/** Oldest-first running fixture e2e runs (for exclusive-start race cleanup). */
export async function listRunningE2eRuns(): Promise<E2eRunRow[]> {
  const { data, error } = await sb()
    .from('e2e_runs')
    .select('*')
    .eq('status', 'running')
    .eq('kind', 'fix_agent_fixture')
    .order('started_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data as E2eRunRow[]) || []
}
