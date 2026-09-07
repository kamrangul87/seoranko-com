import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncAllActiveGscConnections } from '@/lib/gsc/sync'

export const maxDuration = 60

/**
 * Daily GSC metric ingestion for all active connections.
 * Overwrites provisional rows; finals older than the lag window stay stable.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const result = await syncAllActiveGscConnections(supabase)
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
    })
  } catch (err) {
    console.error('[cron/gsc-sync]', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'gsc sync failed' },
      { status: 500 },
    )
  }
}
