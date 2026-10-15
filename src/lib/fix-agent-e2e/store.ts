import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { E2eStepName } from './constants'
import { prepareForwardOnlyE2eWrite } from './step-progress'

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
}

function sb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service role not configured')
  return createClient(url, key)
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

const E2E_STEPS_CAS_ATTEMPTS = 5

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
 * Sole writer for e2e_runs.steps / current_step (compare-and-swap).
 * Heartbeat and ticks must call this — never update steps directly.
 * Forward-only: rejects passed→pending and current_step rewinds (logged).
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
      .select('steps,current_step,updated_at')
      .eq('id', id)
      .maybeSingle()
    if (liveErr) throw new Error(liveErr.message)
    if (!live) throw new Error(`e2e_runs ${id} not found`)

    const liveSteps = (live.steps as E2eStepRecord[]) ?? []
    const liveCurrent =
      typeof live.current_step === 'string' ? live.current_step : null
    const liveUpdatedAt = String(live.updated_at)

    const nextPatch: Record<string, unknown> = { ...patch }
    if (patch.steps !== undefined || patch.current_step !== undefined) {
      const prepared = prepareForwardOnlyE2eWrite({
        liveSteps,
        liveCurrentStep: liveCurrent,
        proposedSteps: patch.steps,
        proposedCurrentStep: patch.current_step,
      })
      for (const reason of prepared.rejected) {
        console.warn(`[e2e_runs] run=${id} ${reason}`)
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

    const nowIso = new Date().toISOString()
    const { data, error } = await client
      .from('e2e_runs')
      .update({ ...nextPatch, updated_at: nowIso })
      .eq('id', id)
      .eq('updated_at', liveUpdatedAt)
      .select('*')
      .maybeSingle()

    if (error) {
      lastErr = error.message
      continue
    }
    if (data) return data as E2eRunRow
    // CAS miss — another writer won; retry with fresh live row.
    lastErr = `e2e_runs CAS conflict on ${id} (attempt ${attempt + 1})`
  }

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
