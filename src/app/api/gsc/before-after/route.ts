import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { normalizeUrl } from '@/lib/supabase/audit-db'
import { computeBeforeAfterForUrl } from '@/lib/gsc/before-after'
import type { DailyUrlMetric } from '@/lib/gsc/baseline-readiness'

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('siteId') || ''
  const url = searchParams.get('url') || ''
  const appliedAt = searchParams.get('appliedAt') || ''
  if (!siteId || !url || !appliedAt) {
    return NextResponse.json({ error: 'siteId, url and appliedAt are required' }, { status: 400 })
  }
  try {
    const sb = createServiceRoleClient()
    const norm = normalizeUrl(url)
    // Pull enough rows to cover a 56-day window around appliedAt.
    const applied = new Date(appliedAt)
    const start = new Date(applied)
    start.setUTCDate(start.getUTCDate() - 60)
    const end = new Date(applied)
    end.setUTCDate(end.getUTCDate() + 60)
    const startYmd = start.toISOString().slice(0, 10)
    const endYmd = end.toISOString().slice(0, 10)
    const { data, error } = await sb
      .from('url_metrics_daily')
      .select('url, date, impressions, clicks, avg_position, is_final')
      .eq('site_id', siteId)
      .eq('url', norm)
      .gte('date', startYmd)
      .lte('date', endYmd)

    if (error) throw new Error(error.message)
    const out = computeBeforeAfterForUrl({
      url: norm,
      rows: (data || []) as DailyUrlMetric[],
      appliedAt,
      baselineDays: 28,
      observationDays: 28,
    })
    return NextResponse.json({
      siteId,
      url: norm,
      ...out,
      label: 'Observed Search Console change (not guaranteed)',
      message:
        out.missingObservationDays > 0
          ? `Check back after ${out.missingObservationDays} day(s) for a full 28-day observation window.`
          : 'Observation window complete.',
    })
  } catch (err) {
    console.error('[gsc/before-after]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}

