/**
 * Finish Intervention → experiment → prereg → causal_results using Postgres
 * (SUPABASE_DB_PASSWORD). Does not need service-role or encryption keys —
 * intended for GitHub Actions migrate CI when those secrets are absent.
 *
 * Skips Fix Agent (interventions must already exist). Idempotent.
 *
 * Usage: npx tsx scripts/complete-causal-loop.ts
 */
import pg from 'pg'
import { analyzeIntervention, causalResultConflictTarget } from '../src/lib/intervention/analyze'
import {
  hashPreregistration,
  type PreregistrationFields,
} from '../src/lib/intervention/preregistration'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'
const DOMAIN = process.env.E2E_DOMAIN || 'autodun.com'

function dbUrl(): string {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL!
  }
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) throw new Error('SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL) required')
  return `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pw)}@${POOLER_HOST}:5432/postgres`
}

async function main() {
  const client = new pg.Client({
    connectionString: dbUrl(),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    const existingCausal = await client.query(
      `SELECT COUNT(*)::int AS n FROM causal_results`,
    )
    if (existingCausal.rows[0].n > 0 && process.env.FORCE_CAUSAL_COMPLETE !== '1') {
      console.log(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: 'causal_results_already_present',
          count: existingCausal.rows[0].n,
        }),
      )
      return
    }

    const sites = await client.query(
      `SELECT id, user_id, domain FROM connected_sites
       WHERE domain ILIKE $1
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
      [DOMAIN],
    )
    if (!sites.rows.length) throw new Error(`No connected_sites for ${DOMAIN}`)
    const site = sites.rows[0]

    const interventions = await client.query(
      `SELECT id, url_id, lifecycle_state, experiment_id, applied_at, verified_at,
              interference_scope, is_isolated, created_at
       FROM intervention_events WHERE site_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [site.id],
    )
    if (!interventions.rows.length) {
      throw new Error('No intervention_events — run Fix Agent e2e first')
    }

    let experimentId: string | null = null
    const existingExp = await client.query(
      `SELECT id FROM experiments WHERE site_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [site.id],
    )
    if (existingExp.rows[0]?.id) {
      experimentId = existingExp.rows[0].id
    } else {
      const created = await client.query(
        `INSERT INTO experiments (site_id, user_id, name, status, min_urls_required)
         VALUES ($1, $2, $3, 'baseline', 30)
         RETURNING id`,
        [site.id, site.user_id, `Intervention measurement — ${DOMAIN}`],
      )
      experimentId = created.rows[0].id
    }

    const fields: PreregistrationFields = {
      primary_metric: 'impressions',
      expected_direction: 'increase',
      baseline_window_days: 28,
      observation_window_days: 28,
      analysis_method: 'difference_in_differences',
      minimum_detectable_effect: null,
    }

    const existingPrereg = await client.query(
      `SELECT id, experiment_id, primary_metric, expected_direction, baseline_window_days,
              observation_window_days, analysis_method, minimum_detectable_effect, locked_at
       FROM experiment_preregistrations WHERE experiment_id = $1`,
      [experimentId],
    )

    if (!existingPrereg.rows.length) {
      await client.query(
        `INSERT INTO experiment_preregistrations (
           experiment_id, user_id, site_id,
           primary_metric, expected_direction, baseline_window_days, observation_window_days,
           analysis_method, minimum_detectable_effect, preregistration_hash, locked_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [
          experimentId,
          site.user_id,
          site.id,
          fields.primary_metric,
          fields.expected_direction,
          fields.baseline_window_days,
          fields.observation_window_days,
          fields.analysis_method,
          fields.minimum_detectable_effect,
          hashPreregistration(fields),
        ],
      )
    }

    const preregRow = (
      await client.query(
        `SELECT * FROM experiment_preregistrations WHERE experiment_id = $1`,
        [experimentId],
      )
    ).rows[0]
    if (!preregRow) throw new Error('preregistration missing after insert')

    await client.query(
      `UPDATE intervention_events SET experiment_id = $1
       WHERE site_id = $2 AND experiment_id IS NULL`,
      [experimentId, site.id],
    )

    const linked = await client.query(
      `SELECT * FROM intervention_events
       WHERE site_id = $1 AND experiment_id = $2
       ORDER BY created_at DESC LIMIT 5`,
      [site.id, experimentId],
    )

    const readiness = await client.query(
      `SELECT passed FROM baseline_readiness_checks
       WHERE site_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [site.id],
    )
    const baselineReadinessPassed = !!readiness.rows[0]?.passed

    const metrics = await client.query(
      `SELECT url, date, impressions, clicks, ctr, avg_position, is_final
       FROM url_metrics_daily WHERE site_id = $1`,
      [site.id],
    )

    const causalAnalyze = []
    for (const intervention of linked.rows) {
      const result = analyzeIntervention({
        intervention: {
          id: intervention.id,
          experiment_id: intervention.experiment_id,
          url_id: intervention.url_id,
          lifecycle_state: intervention.lifecycle_state,
          applied_at: intervention.applied_at
            ? new Date(intervention.applied_at).toISOString()
            : null,
          verified_at: intervention.verified_at
            ? new Date(intervention.verified_at).toISOString()
            : null,
          interference_scope: intervention.interference_scope,
          is_isolated: intervention.is_isolated,
        },
        preregistration: {
          experiment_id: preregRow.experiment_id,
          primary_metric: preregRow.primary_metric,
          expected_direction: preregRow.expected_direction,
          baseline_window_days: preregRow.baseline_window_days,
          observation_window_days: preregRow.observation_window_days,
          analysis_method: preregRow.analysis_method,
          minimum_detectable_effect: preregRow.minimum_detectable_effect,
          locked_at: preregRow.locked_at
            ? new Date(preregRow.locked_at).toISOString()
            : null,
        },
        metric: preregRow.primary_metric,
        metricsRows: metrics.rows.map((m) => ({
          url: m.url,
          date: m.date instanceof Date ? m.date.toISOString().slice(0, 10) : String(m.date),
          impressions: m.impressions,
          clicks: m.clicks,
          ctr: m.ctr,
          avg_position: m.avg_position,
          is_final: m.is_final,
        })),
        treatedUrls: [intervention.url_id],
        controlUrls: [],
        baselineReadinessPassed,
        gscRevisionInBaseline: false,
      })

      const { evidence: _e, ...persistable } = result
      void _e

      const ups = await client.query(
        `
        INSERT INTO causal_results (
          experiment_id, intervention_id, user_id, site_id, metric, is_exploratory,
          effect_estimate, confidence_interval_low, confidence_interval_high,
          treatment_n, control_n,
          baseline_period_start, baseline_period_end,
          observation_period_start, observation_period_end,
          method, validity_status, result_direction, calculated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,
          $10,$11,
          $12,$13,
          $14,$15,
          $16,$17,$18,$19
        )
        ON CONFLICT (${causalResultConflictTarget()}) DO UPDATE SET
          validity_status = EXCLUDED.validity_status,
          effect_estimate = EXCLUDED.effect_estimate,
          treatment_n = EXCLUDED.treatment_n,
          control_n = EXCLUDED.control_n,
          baseline_period_start = EXCLUDED.baseline_period_start,
          baseline_period_end = EXCLUDED.baseline_period_end,
          observation_period_start = EXCLUDED.observation_period_start,
          observation_period_end = EXCLUDED.observation_period_end,
          result_direction = EXCLUDED.result_direction,
          calculated_at = EXCLUDED.calculated_at
        RETURNING id, intervention_id, validity_status, metric, calculated_at
        `,
        [
          persistable.experiment_id,
          persistable.intervention_id,
          site.user_id,
          site.id,
          persistable.metric,
          persistable.is_exploratory,
          persistable.effect_estimate,
          persistable.confidence_interval_low,
          persistable.confidence_interval_high,
          persistable.treatment_n,
          persistable.control_n,
          persistable.baseline_period_start,
          persistable.baseline_period_end,
          persistable.observation_period_start,
          persistable.observation_period_end,
          persistable.method,
          persistable.validity_status,
          persistable.result_direction,
          persistable.calculated_at,
        ],
      )
      causalAnalyze.push({
        ...ups.rows[0],
        evidence: result.evidence,
      })
    }

    const finalCounts = {
      intervention_events: (
        await client.query(`SELECT COUNT(*)::int AS n FROM intervention_events WHERE site_id=$1`, [
          site.id,
        ])
      ).rows[0].n,
      experiment_preregistrations: (
        await client.query(
          `SELECT COUNT(*)::int AS n FROM experiment_preregistrations WHERE site_id=$1`,
          [site.id],
        )
      ).rows[0].n,
      causal_results: (
        await client.query(`SELECT COUNT(*)::int AS n FROM causal_results WHERE site_id=$1`, [
          site.id,
        ])
      ).rows[0].n,
    }

    const linkedIe = await client.query(
      `SELECT id, experiment_id, lifecycle_state FROM intervention_events WHERE site_id=$1`,
      [site.id],
    )

    console.log(
      JSON.stringify(
        {
          ok: true,
          site: { id: site.id, domain: site.domain },
          experimentId,
          interventions: linkedIe.rows,
          causalAnalyze,
          finalCounts,
        },
        null,
        2,
      ),
    )
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  )
  process.exit(1)
})
