import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import {
  hashPreregistration,
  isPrimaryMetric,
  type ExpectedDirection,
  type PrimaryMetric,
} from '@/lib/intervention/preregistration'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireUser() {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const {
    data: { user },
  } = await authClient.auth.getUser()
  return user
}

/**
 * POST { siteId, name?, primaryMetric?, expectedDirection?,
 *        baselineWindowDays?, observationWindowDays?, minimumDetectableEffect? }
 *
 * Creates an experiment shell + locked pre-registration in one step.
 * Links any unlinked intervention_events for the site to this experiment.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const supabase = serviceClient()
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const primaryMetric: PrimaryMetric =
      typeof body.primaryMetric === 'string' && isPrimaryMetric(body.primaryMetric)
        ? body.primaryMetric
        : 'impressions'
    const expectedDirection: ExpectedDirection =
      body.expectedDirection === 'decrease' ||
      body.expectedDirection === 'no_prediction' ||
      body.expectedDirection === 'increase'
        ? body.expectedDirection
        : 'increase'
    const baselineWindowDays =
      typeof body.baselineWindowDays === 'number' && body.baselineWindowDays > 0
        ? Math.floor(body.baselineWindowDays)
        : 28
    const observationWindowDays =
      typeof body.observationWindowDays === 'number' && body.observationWindowDays > 0
        ? Math.floor(body.observationWindowDays)
        : 28
    const minimumDetectableEffect =
      typeof body.minimumDetectableEffect === 'number' ? body.minimumDetectableEffect : null

    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : `Intervention measurement — ${site.domain}`

    const { data: experiment, error: expErr } = await supabase
      .from('experiments')
      .insert({
        site_id: siteId,
        user_id: user.id,
        name,
        status: 'baseline',
        min_urls_required: 30,
      })
      .select('id, name, status, created_at')
      .maybeSingle()

    if (expErr || !experiment) {
      return NextResponse.json(
        { error: expErr?.message || 'Could not create experiment' },
        { status: 500 },
      )
    }

    const preregFields = {
      primary_metric: primaryMetric,
      expected_direction: expectedDirection,
      baseline_window_days: baselineWindowDays,
      observation_window_days: observationWindowDays,
      analysis_method: 'difference_in_differences' as const,
      minimum_detectable_effect: minimumDetectableEffect,
    }
    const preregistration_hash = hashPreregistration(preregFields)

    const { data: prereg, error: preregErr } = await supabase
      .from('experiment_preregistrations')
      .insert({
        experiment_id: experiment.id,
        user_id: user.id,
        site_id: siteId,
        ...preregFields,
        preregistration_hash,
        locked_at: new Date().toISOString(),
      })
      .select('id, experiment_id, primary_metric, locked_at')
      .maybeSingle()

    if (preregErr || !prereg) {
      // Roll back the experiment shell so we don't leave an unusable row.
      await supabase.from('experiments').delete().eq('id', experiment.id)
      return NextResponse.json(
        { error: preregErr?.message || 'Could not lock pre-registration' },
        { status: 500 },
      )
    }

    // Attach unlinked interventions so analyze can persist causal_results.
    const { data: linked } = await supabase
      .from('intervention_events')
      .update({ experiment_id: experiment.id })
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .is('experiment_id', null)
      .select('id')

    return NextResponse.json({
      ok: true,
      experiment,
      preregistration: prereg,
      linkedInterventionIds: (linked || []).map((r) => r.id),
    })
  } catch (err) {
    console.error('[experiments create]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not create experiment' }, { status: 500 })
  }
}
