#!/usr/bin/env node
/**
 * Attempt one real GSC URL Inspection against an active connection.
 * Never fabricates rows — exits 0 with skipped reason when no token/property.
 *
 * Prefers service-role + scheduler. Falls back to read-only Postgres count
 * when service-role secrets are absent (still never fabricates inspections).
 */
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'

function dbUrl() {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  }
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) return null
  return `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pw)}@${POOLER_HOST}:5432/postgres`
}

async function countInspectionsViaPg() {
  const url = dbUrl()
  if (!url) return null
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM gsc_url_inspections`,
    )
    const latest = await client.query(
      `SELECT id, url, inspected_at, verdict, coverage_state, last_crawl_time, status
       FROM gsc_url_inspections
       ORDER BY inspected_at DESC NULLS LAST
       LIMIT 3`,
    )
    const conns = await client.query(
      `SELECT id, property_url, status FROM gsc_connections
       WHERE status = 'active' AND property_url IS NOT NULL
       LIMIT 5`,
    )
    return {
      count: rows[0]?.n ?? 0,
      latest: latest.rows,
      activeConnections: conns.rows,
    }
  } finally {
    await client.end()
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const canCallApi = Boolean(url && key && !url.includes('127.0.0.1'))

  if (!canCallApi) {
    const snap = await countInspectionsViaPg()
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: 'hosted_supabase_service_role_unavailable_in_this_environment',
          countBefore: snap?.count ?? null,
          countAfter: snap?.count ?? null,
          wrote: false,
          latest: snap?.latest || [],
          activeConnections: snap?.activeConnections || [],
          actionRequired:
            (snap?.count ?? 0) < 1
              ? 'Ensure GSC OAuth token is valid, then click Sync Google’s last recorded view on Audit (or wait for daily gsc-sync cron with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SITE_CONNECTION_ENCRYPTION_KEY in Actions).'
              : null,
        },
        null,
        2,
      ),
    )
    return
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const before = await supabase
    .from('gsc_url_inspections')
    .select('id', { count: 'exact', head: true })
  const countBefore = before.count ?? 0

  const { data: conns, error } = await supabase
    .from('gsc_connections')
    .select('id, site_id, property_url, status')
    .eq('status', 'active')
    .not('property_url', 'is', null)
    .limit(3)

  if (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }))
    process.exitCode = 1
    return
  }
  if (!conns?.length) {
    console.log(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'no_active_gsc_connection',
        countBefore,
      }),
    )
    return
  }

  const { syncUrlInspectionsForConnection } = await import(
    '../src/lib/gsc/inspection-scheduler.ts'
  )

  const results = []
  for (const c of conns) {
    try {
      const r = await syncUrlInspectionsForConnection(supabase, c.id, { batchCap: 1 })
      results.push({
        connectionId: c.id,
        propertyUrl: c.property_url,
        inspected: r.inspected,
        errors: r.errors.slice(0, 3),
        sampleDeltas: r.sampleDeltas,
        exhausted: r.exhausted,
        stoppedReason: r.stoppedReason,
      })
      if (r.inspected > 0) break
    } catch (err) {
      results.push({
        connectionId: c.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const after = await supabase
    .from('gsc_url_inspections')
    .select('id, url, inspected_at, verdict, coverage_state, last_crawl_time, status', {
      count: 'exact',
    })
    .order('inspected_at', { ascending: false })
    .limit(3)

  console.log(
    JSON.stringify(
      {
        ok: true,
        countBefore,
        countAfter: after.count ?? null,
        wrote: (after.count ?? 0) > countBefore,
        latest: after.data || [],
        results,
        actionRequired:
          (after.count ?? 0) <= countBefore
            ? 'Ensure GSC connection token is valid, then click Sync Google’s last recorded view on Audit, or wait for daily gsc-sync cron.'
            : null,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  )
  process.exit(1)
})
