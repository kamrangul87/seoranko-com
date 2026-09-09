/**
 * Production e2e: run Fix Agent remove-dead-link for /privacy on autodun.com,
 * ensure experiment + prereg exist, run analyze → causal_results insufficient_data.
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SITE_CONNECTION_ENCRYPTION_KEY
 *
 * Usage: npx tsx scripts/run-autodun-intervention-e2e.ts
 */
import { createClient } from '@supabase/supabase-js'
import { runFixAgent } from '../src/lib/fix-agent'
import type { PageAuditIssue } from '../src/lib/page-audit-engine'
import { hashPreregistration } from '../src/lib/intervention/preregistration'
import { analyzeIntervention, causalResultConflictTarget } from '../src/lib/intervention/analyze'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  }
  if (!process.env.SITE_CONNECTION_ENCRYPTION_KEY) {
    throw new Error('SITE_CONNECTION_ENCRYPTION_KEY required to decrypt site_connections')
  }

  const supabase = createClient(url, key)
  const domain = process.env.E2E_DOMAIN || 'autodun.com'
  const auditUrl = process.env.E2E_AUDIT_URL || `https://${domain}/`
  const deadUrl = process.env.E2E_DEAD_URL || `https://${domain}/privacy`

  const { data: site, error: siteErr } = await supabase
    .from('connected_sites')
    .select('id, user_id, domain')
    .ilike('domain', domain)
    .limit(1)
    .maybeSingle()
  if (siteErr || !site) throw new Error(siteErr?.message || `No connected_sites for ${domain}`)

  const { data: existingInterventions } = await supabase
    .from('intervention_events')
    .select('id')
    .eq('site_id', site.id)
    .limit(1)

  if (!existingInterventions?.length) {
    const issue: PageAuditIssue = {
      id: `e2e-dead-link-remove-${encodeURIComponent(deadUrl)}`,
      severity: 'critical',
      category: 'link-graph',
      title: `Remove dead internal link to /privacy`,
      description: 'E2E: /privacy returns 4xx; remove outbound links from source.',
      remediation: 'Auto-fixable dead-link removal.',
      fixMetadata: {
        kind: 'remove-dead-link',
        deadUrl,
        sourceUrls: [auditUrl],
        evidence: 'e2e-privacy',
      },
    }

    console.log(JSON.stringify({ step: 'fix_agent_start', siteId: site.id, auditUrl, deadUrl }))
    const fixResult = await runFixAgent({
      supabase,
      userId: site.user_id,
      auditUrl,
      issues: [issue],
      confirmSiteId: site.id,
      langHint: 'en',
    })
    console.log(
      JSON.stringify({
        step: 'fix_agent_done',
        ok: fixResult.ok,
        applied: fixResult.applied?.map((a) => ({
          autoKind: a.autoKind,
          status: a.status,
          verificationDetail: a.verificationDetail,
          errorMessage: a.errorMessage,
        })),
        humanTasks: fixResult.humanTasks,
      }),
    )
  } else {
    console.log(
      JSON.stringify({
        step: 'fix_agent_skipped',
        reason: 'intervention_events_already_present',
        countHint: existingInterventions.length,
      }),
    )
  }

  const { data: interventions } = await supabase
    .from('intervention_events')
    .select('id, lifecycle_state, experiment_id, applied_at, verified_at, intervention_type, intervention_subtype')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })
    .limit(10)
  console.log(JSON.stringify({ step: 'intervention_events', rows: interventions || [] }))
  if (!interventions?.length) {
    throw new Error('No intervention_events after Fix Agent — cannot complete causal e2e')
  }

  // Ensure experiment + locked prereg exist (create prereg even if experiment shell already exists)
  let experimentId: string | null = null
  const { data: existingExp } = await supabase
    .from('experiments')
    .select('id')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingExp?.id) {
    experimentId = existingExp.id
  } else {
    const { data: created, error: expErr } = await supabase
      .from('experiments')
      .insert({
        site_id: site.id,
        user_id: site.user_id,
        name: `Intervention measurement — ${domain}`,
        status: 'baseline',
        min_urls_required: 30,
      })
      .select('id')
      .maybeSingle()
    if (expErr || !created) throw new Error(expErr?.message || 'experiment insert failed')
    experimentId = created.id
  }

  const { data: existingPrereg } = await supabase
    .from('experiment_preregistrations')
    .select('id, experiment_id')
    .eq('experiment_id', experimentId)
    .maybeSingle()

  if (!existingPrereg) {
    const fields = {
      primary_metric: 'impressions' as const,
      expected_direction: 'increase' as const,
      baseline_window_days: 28,
      observation_window_days: 28,
      analysis_method: 'difference_in_differences' as const,
      minimum_detectable_effect: null as number | null,
    }
    const { error: prErr } = await supabase.from('experiment_preregistrations').insert({
      experiment_id: experimentId,
      user_id: site.user_id,
      site_id: site.id,
      ...fields,
      preregistration_hash: hashPreregistration(fields),
      locked_at: new Date().toISOString(),
    })
    if (prErr) throw new Error(prErr.message)
  }

  await supabase
    .from('intervention_events')
    .update({ experiment_id: experimentId })
    .eq('site_id', site.id)
    .is('experiment_id', null)

  const { data: prereg } = await supabase
    .from('experiment_preregistrations')
    .select('*')
    .eq('experiment_id', experimentId)
    .maybeSingle()
  if (!prereg) throw new Error('missing preregistration')

  const { data: readinessRows } = await supabase
    .from('baseline_readiness_checks')
    .select('passed')
    .eq('site_id', site.id)
    .order('checked_at', { ascending: false })
    .limit(1)
  const baselineReadinessPassed = !!readinessRows?.[0]?.passed

  const { data: metrics } = await supabase
    .from('url_metrics_daily')
    .select('url, date, impressions, clicks, ctr, avg_position, is_final')
    .eq('site_id', site.id)

  const { data: toAnalyze } = await supabase
    .from('intervention_events')
    .select('*')
    .eq('site_id', site.id)
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false })
    .limit(5)

  const causalRows = []
  for (const intervention of toAnalyze || []) {
    const result = analyzeIntervention({
      intervention: {
        id: intervention.id,
        experiment_id: intervention.experiment_id,
        url_id: intervention.url_id || intervention.url,
        lifecycle_state: intervention.lifecycle_state,
        applied_at: intervention.applied_at,
        verified_at: intervention.verified_at,
        interference_scope: intervention.interference_scope,
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
      metric: prereg.primary_metric,
      metricsRows: metrics || [],
      treatedUrls: [intervention.url_id || intervention.url || auditUrl],
      controlUrls: [],
      baselineReadinessPassed,
      gscRevisionInBaseline: false,
    })
    const { evidence: _e, ...persistable } = result
    void _e
    await supabase.from('causal_results').upsert(
      {
        ...persistable,
        user_id: site.user_id,
        site_id: site.id,
      },
      { onConflict: causalResultConflictTarget() },
    )
    causalRows.push({
      intervention_id: intervention.id,
      validity_status: result.validity_status,
      evidence: result.evidence,
    })
  }

  const { data: causalFinal } = await supabase
    .from('causal_results')
    .select('id, intervention_id, validity_status, metric, calculated_at')
    .eq('site_id', site.id)
    .order('calculated_at', { ascending: false })
    .limit(10)

  console.log(
    JSON.stringify(
      {
        ok: true,
        site,
        experimentId,
        interventions: interventions || [],
        causalAnalyze: causalRows,
        causal_results: causalFinal || [],
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  process.exit(1)
})
