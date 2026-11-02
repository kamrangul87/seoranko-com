import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { gscAvailableEndDate } from '@/lib/gsc/client'
import { aggregateWindowForQueryPage, pickWindowDates, type QueryPageDaily } from '@/lib/gsc/opportunities'

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('siteId') || ''
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }
  try {
    const sb = createServiceRoleClient()

    // Pull up to ~120 days of final rows; pick a 28-day window ending at the latest available date.
    const end = gscAvailableEndDate()
    const d = new Date(`${end}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() - 119)
    const start120 = d.toISOString().slice(0, 10)

    const { data, error } = await sb
      .from('gsc_query_page_daily')
      .select('url, query, date, clicks, impressions, avg_position, is_final')
      .eq('site_id', siteId)
      .eq('is_final', true)
      .gte('date', start120)
      .order('date', { ascending: true })

    if (error) throw new Error(error.message)
    const rows = (data || []) as QueryPageDaily[]
    const window = pickWindowDates(rows.map((r) => r.date), 28, 90)
    if (!window) {
      return NextResponse.json({
        siteId,
        windowDays: 0,
        opportunities: [],
        message:
          'No finalized Search Console data yet. Connect Search Console and wait for the next sync.',
      })
    }
    const opps = aggregateWindowForQueryPage(rows, window.startDate, window.endDate)
    return NextResponse.json({
      siteId,
      windowDays: window.windowDays,
      startDate: window.startDate,
      endDate: window.endDate,
      opportunities: opps,
      note:
        'Based on finalized Search Console data. Suggestions are observational, not guarantees. No ranking promises.',
    })
  } catch (err) {
    console.error('[gsc/opportunities]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}

