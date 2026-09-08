import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import {
  analyzeIntervention,
  causalResultConflictTarget,
  type CausalResultRow,
} from '@/lib/intervention/analyze'
import {
  assertAnalysisMetricAllowed,
  isPrimaryMetric,
  type PrimaryMetric,
} from '@/lib/intervention/preregistration'
import type { InterferenceScope } from '@/lib/intervention/taxonomy'

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
 * POST { siteId, interventionId?, metric?, exploratory? }
 * Runs causal analysis for one or all interventions on a site.
 * Expected early outcome on under-ready sites: insufficient_data.
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

    let interventionQuery = supabase
      .from('intervention_events')
      .select('*')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (typeof body.interventionId === 'string' && body.interventionId) {
      interventionQuery = interventionQuery.eq('id', body.interventionId)
    }

    const { data: interventions, error: intErr } = await interventionQuery.limit(50)
    if (intErr) {
      return NextResponse.json({ error: intErr.message }, { status: 500 })
    }

    if (!interventions || interventions.length === 0) {
      return NextResponse.json({
        ok: true,
        site,
        results: [
          {
            validity_status: 'insufficient_data',
            evidence: { reason: 'no_intervention_events' },
            effect_estimate: null,
            result_direction: null,
          },
        ],
        message: 'insufficient evidence',
      })
    }

    const { data: readinessRows } = await supabase
      .from('baseline_readiness_checks')
      .select('passed')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .order('checked_at', { ascending: false })
      .limit(1)

    const baselineReadinessPassed = !!readinessRows?.[0]?.passed

    const { data: metrics } = await supabase
      .from('url_metrics_daily')
      .select('url, date, impressions, clicks, ctr, avg_position, is_final')
      .eq('site_id', siteId)

    const results: CausalResultRow[] = []

    for (const intervention of interventions) {
      if (!intervention.experiment_id) {
        results.push({
          experiment_id: '',
          intervention_id: intervention.id,
          metric: 'impressions',
          is_exploratory: false,
          effect_estimate: null,
          confidence_interval_low: null,
          confidence_interval_high: null,
          treatment_n: 0,
          control_n: 0,
          baseline_period_start: '',
          baseline_period_end: '',
          observation_period_start: '',
          observation_period_end: '',
          method: 'difference_in_differences',
          validity_status: 'insufficient_data',
          result_direction: null,
          calculated_at: new Date().toISOString(),
          evidence: { reason: 'no_experiment_linked' },
        })
        continue
      }

      const { data: prereg } = await supabase
        .from('experiment_preregistrations')
        .select('*')
        .eq('experiment_id', intervention.experiment_id)
        .maybeSingle()

      if (!prereg) {
        results.push({
          experiment_id: intervention.experiment_id,
          intervention_id: intervention.id,
          metric: 'impressions',
          is_exploratory: false,
          effect_estimate: null,
          confidence_interval_low: null,
          confidence_interval_high: null,
          treatment_n: 0,
          control_n: 0,
          baseline_period_start: '',
          baseline_period_end: '',
          observation_period_start: '',
          observation_period_end: '',
          method: 'difference_in_differences',
          validity_status: 'insufficient_data',
          result_direction: null,
          calculated_at: new Date().toISOString(),
          evidence: { reason: 'no_preregistration' },
        })
        continue
      }

      const requested =
        typeof body.metric === 'string' && isPrimaryMetric(body.metric)
          ? body.metric
          : (prereg.primary_metric as PrimaryMetric)
      const exploratory = !!body.exploratory && requested !== prereg.primary_metric

      try {
        assertAnalysisMetricAllowed(prereg.primary_metric, requested, { exploratory })
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Metric refused' },
          { status: 400 },
        )
      }

      const { data: experimentUrls } = await supabase
        .from('experiment_urls')
        .select('url, cohort')
        .eq('experiment_id', intervention.experiment_id)

      const treatedUrls = (experimentUrls || [])
        .filter((u) => u.cohort === 'treated')
        .map((u) => u.url)
      const controlUrls = (experimentUrls || [])
        .filter((u) => u.cohort === 'holdout')
        .map((u) => u.url)

      const { data: revisionRows } = await supabase
        .from('gsc_revision_checks')
        .select('revision_detected, window_start, window_end')
        .eq('experiment_id', intervention.experiment_id)
        .eq('revision_detected', true)
        .limit(5)

      const gscRevisionInBaseline = (revisionRows || []).length > 0

      const result = analyzeIntervention({
        intervention: {
          id: intervention.id,
          experiment_id: intervention.experiment_id,
          url_id: intervention.url_id,
          lifecycle_state: intervention.lifecycle_state,
          applied_at: intervention.applied_at,
          verified_at: intervention.verified_at,
          interference_scope: intervention.interference_scope as InterferenceScope,
          is_isolated: intervention.is_isolated,
        },
        preregistration: {
          experiment_id: prereg.experiment_id,
          primary_metric: prereg.primary_metric,
          expected_direction: prereg.expected_direction,
          baseline_window_days: prereg.baseline_window_days,
          observation_window_days: prereg.observation_window_days,
          analysis_method: prereg.analysis_method,
          minimum_detectable_effect: prereg.minimum_detectable_effect,
          locked_at: prereg.locked_at,
        },
        metric: requested,
        exploratory,
        metricsRows: metrics || [],
        treatedUrls: treatedUrls.length ? treatedUrls : [intervention.url_id],
        controlUrls,
        baselineReadinessPassed,
        gscRevisionInBaseline,
      })

      const { evidence: _evidence, ...persistable } = result
      void _evidence

      await supabase.from('causal_results').upsert(
        {
          ...persistable,
          user_id: user.id,
          site_id: siteId,
        },
        { onConflict: causalResultConflictTarget() },
      )

      results.push(result)
    }

    const anyValid = results.some((r) => r.validity_status === 'valid')
    return NextResponse.json({
      ok: true,
      site,
      results,
      message: anyValid ? undefined : 'insufficient evidence',
    })
  } catch (err) {
    console.error('[experiments analyze]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not run analysis' }, { status: 500 })
  }
}
