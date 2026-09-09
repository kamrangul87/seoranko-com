#!/usr/bin/env node
/**
 * Attempt one real GSC URL Inspection against an active connection.
 * Never fabricates rows — exits 0 with skipped reason when no token/property.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      SITE_CONNECTION_ENCRYPTION_KEY (for token decrypt via existing helpers),
 *      or SUPABASE_DB_PASSWORD for pg path.
 *
 * Prefer service-role + existing scheduler when secrets present.
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || url.includes('127.0.0.1')) {
    console.log(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'hosted_supabase_service_role_unavailable_in_this_environment',
      }),
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

  // Dynamic import so local typecheck without full Next graph still works under tsx
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
