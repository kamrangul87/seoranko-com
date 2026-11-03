import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { gscAvailableEndDate } from '@/lib/gsc/client'
import { aggregateWindowForQueryPage, pickWindowDates, type QueryPageDaily } from '@/lib/gsc/opportunities'
import { suggestInternalLinks } from '@/lib/gsc/internal-link-suggest'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('siteId') || ''
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  try {
    const sb = createServiceRoleClient()
    // Fetch 120-day window for aggregation
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
      return NextResponse.json({ siteId, windowDays: 0, suggestions: [] })
    }
    // Compute Page-2 opportunities: top queries per target URL
    const oppRows = aggregateWindowForQueryPage(rows, window.startDate, window.endDate)
    // Build candidate source strengths across the site (sum impressions by url)
    const byUrl = new Map<string, number>()
    for (const r of rows) {
      if (!r.is_final) continue
      if (r.date < window.startDate || r.date > window.endDate) continue
      byUrl.set(r.url, (byUrl.get(r.url) || 0) + (Number(r.impressions) || 0))
    }
    const candidateSources = Array.from(byUrl.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([url, impressions]) => ({ url, impressions }))
    // site origin
    const origin = (() => {
      const any = oppRows[0]?.url || rows[0]?.url || ''
      try {
        return new URL(any).origin
      } catch {
        return ''
      }
    })()
    const groupedByTarget = new Map<string, string[]>()
    for (const r of oppRows) {
      const list = groupedByTarget.get(r.url) || []
      if (!list.includes(r.query)) list.push(r.query)
      groupedByTarget.set(r.url, list)
    }
    const suggestions: Array<{
      targetUrl: string
      anchorText: string
      sources: Array<{ sourceUrl: string; insertion: 'related-list' }>
    }> = []
    for (const [targetUrl, queries] of groupedByTarget) {
      const sug = await suggestInternalLinks({
        siteOrigin: origin,
        targetUrl,
        targetQueries: queries,
        candidateSources,
        maxSuggestions: 3,
      })
      if (sug.length > 0) {
        suggestions.push({
          targetUrl,
          anchorText: sug[0]!.anchorText,
          sources: sug.map((s) => ({ sourceUrl: s.sourceUrl, insertion: s.insertion })),
        })
      }
    }
    return NextResponse.json({
      siteId,
      startDate: window.startDate,
      endDate: window.endDate,
      windowDays: window.windowDays,
      suggestions,
    })
  } catch (err) {
    console.error('[gsc/internal-links/suggest]', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

