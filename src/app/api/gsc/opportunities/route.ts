import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { gscAvailableEndDate } from '@/lib/gsc/client'
import { type QueryPageDaily } from '@/lib/gsc/opportunities'
import { page2OpportunitiesFromRows, page2WindowFromRows } from '@/lib/gsc/weekly-report'
import { asPage2SuggestionsCache } from '@/lib/gsc/precompute-suggestions'

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

    if (error) {
      const msg = String(error.message || '')
      const relationMissing =
        /gsc_query_page_daily/.test(msg) && (/does not exist/.test(msg) || /relation/.test(msg))
      if (relationMissing) {
        return NextResponse.json({
          siteId,
          windowDays: 0,
          opportunities: [],
          message:
            'Search Console query+page data not stored yet. Deploy needs to apply the new migration; until then this section stays empty.',
        })
      }
      throw new Error(error.message)
    }
    const rows = (data || []) as QueryPageDaily[]
    const window = page2WindowFromRows(rows)
    if (!window) {
      return NextResponse.json({
        siteId,
        windowDays: 0,
        opportunities: [],
        message:
          'No finalized Search Console data yet. Connect Search Console and wait for the next sync.',
      })
    }
    const opps = page2OpportunitiesFromRows(rows)
    let suggestions: ReturnType<typeof asPage2SuggestionsCache> = null
    try {
      const { data: conn } = await sb
        .from('gsc_connections')
        .select('page2_suggestions')
        .eq('site_id', siteId)
        .eq('status', 'active')
        .maybeSingle()
      suggestions = asPage2SuggestionsCache(conn?.page2_suggestions)
    } catch {
      suggestions = null
    }
    return NextResponse.json({
      siteId,
      windowDays: window.windowDays,
      startDate: window.startDate,
      endDate: window.endDate,
      opportunities: opps,
      suggestions,
      note:
        'Based on finalized Search Console data. Suggestions are observational, not guarantees. No ranking promises.',
    })
  } catch (err) {
    console.error('[gsc/opportunities]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}

