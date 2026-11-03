import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { gscAvailableEndDate } from '@/lib/gsc/client'
import { pickWindowDates, type QueryPageDaily } from '@/lib/gsc/opportunities'
import { suggestTitleAndDescription } from '@/lib/gsc/title-meta-suggest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request): Promise<Response> {
  const urlObj = new URL(req.url)
  const siteId = urlObj.searchParams.get('siteId') || ''
  const pageUrl = urlObj.searchParams.get('url') || ''
  if (!siteId || !pageUrl) {
    return NextResponse.json({ error: 'siteId and url are required' }, { status: 400 })
  }
  try {
    const sb = createServiceRoleClient()
    // Fetch up to ~120 days of finalized query-page rows for this URL
    const end = gscAvailableEndDate()
    const d = new Date(`${end}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() - 119)
    const start120 = d.toISOString().slice(0, 10)
    const { data, error } = await sb
      .from('gsc_query_page_daily')
      .select('url, query, date, clicks, impressions, avg_position, is_final')
      .eq('site_id', siteId)
      .eq('is_final', true)
      .eq('url', pageUrl)
      .gte('date', start120)
      .order('date', { ascending: true })
    if (error) throw new Error(error.message)
    const rows = (data || []) as QueryPageDaily[]
    const window = pickWindowDates(rows.map((r) => r.date), 28, 90)
    const byImpressions = new Map<string, number>()
    if (window) {
      for (const r of rows) {
        if (!r.is_final) continue
        if (r.date < window.startDate || r.date > window.endDate) continue
        byImpressions.set(r.query, (byImpressions.get(r.query) || 0) + (Number(r.impressions) || 0))
      }
    }
    const topQueries = Array.from(byImpressions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([q]) => q)
    // Fetch live page HTML (best-effort)
    let html = ''
    try {
      const res = await fetch(pageUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) })
      const ct = res.headers.get('content-type') || ''
      if (res.ok && /text\/html/i.test(ct)) {
        html = await res.text()
      }
    } catch {
      /* ignore network errors; suggestions will be empty */
    }
    if (!html || topQueries.length === 0) {
      return NextResponse.json({
        url: pageUrl,
        suggestion: null,
        note: 'Insufficient data to build a suggestion',
      })
    }
    const suggestion = suggestTitleAndDescription({ url: pageUrl, html, queries: topQueries })
    return NextResponse.json({ url: pageUrl, suggestion, queries: topQueries })
  } catch (err) {
    console.error('[gsc/title-meta/suggest]', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

