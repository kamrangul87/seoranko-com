import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { requireCronSecret } from '@/lib/cron-auth'
import { syncAllActiveGscConnections } from '@/lib/gsc/sync'
import { syncAllUrlInspections } from '@/lib/gsc/inspection-scheduler'


export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Daily GSC metric ingestion + quota-aware URL Inspection batch.
 * Metrics first; inspections degrade gracefully when quota is exhausted.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const supabase = createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const result = await syncAllActiveGscConnections(supabase)
    let inspections: Awaited<ReturnType<typeof syncAllUrlInspections>> | null = null
    try {
      inspections = await syncAllUrlInspections(supabase)
    } catch (err) {
      console.error(
        '[cron/gsc-sync] url inspection batch',
        err instanceof Error ? err.message : err,
      )
    }

    return NextResponse.json({
      ok: true,
      synced: result.synced,
      failed: result.failed,
      results: result.results.map((r) => ({
        siteId: r.siteId,
        propertyUrl: r.propertyUrl,
        rowsUpserted: r.rowsUpserted,
        pagesFetched: r.pagesFetched,
        readinessPassed: r.readinessPassed,
        readinessReason: r.readinessReason,
        error: r.error || null,
      })),
      inspections: inspections
        ? {
            synced: inspections.synced,
            failed: inspections.failed,
            results: inspections.results.map((r) => ({
              siteId: r.siteId,
              propertyUrl: r.propertyUrl,
              inspected: r.inspected,
              deferred: r.deferred,
              remainingBudget: r.remainingBudget,
              exhausted: r.exhausted,
              skippedExcluded: r.skippedExcluded,
              stoppedReason: r.stoppedReason,
              sampleDeltas: r.sampleDeltas,
              errors: r.errors.slice(0, 5),
            })),
          }
        : { error: 'inspection_batch_failed' },
    })
  } catch (err) {
    console.error('[cron/gsc-sync]', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'gsc sync failed' },
      { status: 500 },
    )
  }
}
