#!/usr/bin/env node
/**
 * Phase 4 beta-readiness: report current usage vs known quotas/limits.
 * Never fabricates usage. Vercel live minutes require VERCEL_TOKEN (+ team/project).
 *
 * Env: SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL), optional VERCEL_TOKEN,
 *      VERCEL_PROJECT_ID / VERCEL_TEAM_ID
 */
import pg from 'pg'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'

/** Documented product / plan ceilings we check against (not invented live readings). */
const LIMITS = {
  gscInspectionDailySoftCap: 1950,
  gscInspectionDailyHard: 2000,
  vercelHobbyCronMaxPerDay: 1, // schedule frequency constraint, not a minute meter
  // Supabase free/pro varies by project plan — report size + rows; flag if unknown plan.
}

function dbUrl() {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  }
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) return null
  return `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pw)}@${POOLER_HOST}:5432/postgres`
}

async function vercelFunctionUsage() {
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID
  if (!token) {
    return {
      available: false,
      reason: 'VERCEL_TOKEN not set in this environment',
      configuredEnvelope: {
        gscSyncMaxDurationSec: 60,
        note: 'Hobby cron must remain once-daily; see vercel.json',
      },
      actionRequired:
        'Add VERCEL_TOKEN (+ VERCEL_PROJECT_ID / VERCEL_TEAM_ID) to Actions secrets to report live function-minute usage.',
    }
  }
  try {
    const qs = new URLSearchParams()
    if (teamId) qs.set('teamId', teamId)
    // Usage endpoint varies by plan; attempt project-level analytics if present.
    const url = projectId
      ? `https://api.vercel.com/v1/projects/${projectId}?${qs}`
      : `https://api.vercel.com/v2/user?${qs}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })
    const body = await res.json().catch(() => ({}))
    return {
      available: res.ok,
      httpStatus: res.status,
      project: body?.name || body?.id || null,
      rawHint: res.ok
        ? 'Token valid — wire Vercel usage API for minute totals when account plan exposes them.'
        : body?.error?.message || 'Vercel API request failed',
      configuredEnvelope: { gscSyncMaxDurationSec: 60 },
    }
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
      configuredEnvelope: { gscSyncMaxDurationSec: 60 },
    }
  }
}

async function main() {
  const url = dbUrl()
  if (!url) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'no_db_credentials' }))
    return
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const quota = await client.query(`
      SELECT property_url, day, requests_used, succeeded, failed,
             quota_exhausted_count, updated_at
      FROM gsc_inspection_quota_usage
      WHERE day >= (CURRENT_DATE - INTERVAL '3 days')
      ORDER BY day DESC, requests_used DESC
      LIMIT 20
    `)

    const todayUsed = await client.query(`
      SELECT COALESCE(SUM(requests_used), 0)::int AS used
      FROM gsc_inspection_quota_usage
      WHERE day = CURRENT_DATE
    `)

    const dbSize = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty,
             pg_database_size(current_database())::bigint AS bytes
    `)

    const tableStats = await client.query(`
      SELECT relname AS table,
             n_live_tup::bigint AS live_rows,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS size
      FROM pg_stat_user_tables s
      JOIN pg_class c ON c.relname = s.relname
      WHERE schemaname = 'public'
        AND relname IN (
          'gsc_url_inspections','gsc_inspection_quota_usage','url_metrics_daily',
          'fix_agent_attempts','intervention_events','causal_results',
          'index_diagnosis_runs','link_graph_audits','connected_sites','site_connections'
        )
      ORDER BY n_live_tup DESC
    `)

    const connCounts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM connected_sites) AS sites,
        (SELECT COUNT(*)::int FROM site_connections WHERE is_active) AS active_cms,
        (SELECT COUNT(*)::int FROM site_connections WHERE is_active AND cms_type = 'github') AS github,
        (SELECT COUNT(*)::int FROM gsc_connections WHERE status = 'active') AS gsc_active,
        (SELECT COUNT(*)::int FROM gsc_url_inspections) AS inspections,
        (SELECT COUNT(*)::int FROM intervention_events WHERE lifecycle_state = 'verified') AS verified_interventions
    `)

    const vercel = await vercelFunctionUsage()
    const gscUsedToday = todayUsed.rows[0]?.used ?? 0

    console.log(
      JSON.stringify(
        {
          ok: true,
          limits: LIMITS,
          gsc: {
            usedToday: gscUsedToday,
            softCap: LIMITS.gscInspectionDailySoftCap,
            hardDaily: LIMITS.gscInspectionDailyHard,
            remainingVsSoftCap: Math.max(0, LIMITS.gscInspectionDailySoftCap - gscUsedToday),
            recentRows: quota.rows,
            nearCap: gscUsedToday >= LIMITS.gscInspectionDailySoftCap * 0.8,
          },
          supabase: {
            databaseSize: dbSize.rows[0],
            tableStats: tableStats.rows,
            inventory: connCounts.rows[0],
            note: 'Plan disk/egress ceilings are account-specific — compare size against Supabase dashboard plan.',
          },
          vercel,
          warnings: [
            ...(gscUsedToday >= LIMITS.gscInspectionDailySoftCap * 0.8
              ? ['GSC inspection soft cap ≥80% used today']
              : []),
            ...(!vercel.available ? ['Vercel live function-minute usage not readable'] : []),
          ],
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
