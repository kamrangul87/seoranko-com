import { NextResponse, NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { gscAvailableEndDate } from '@/lib/gsc/client'
import { pickWindowDates, aggregateWindowForQueryPage, type QueryPageDaily } from '@/lib/gsc/opportunities'
import { listFixReceiptsForSite } from '@/lib/fix-strategies/findings-ui/fix-receipt'
import { computeBeforeAfterForUrl } from '@/lib/gsc/before-after'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isQuestionLike(q: string): boolean {
  return /\b(what|how|why|when|where|who|can|does|do|is|are|should|faq|guide)\b/i.test(q) || /\?$/.test(q.trim())
}

function shouldTargetPricing(q: string): boolean {
  return /\b(price|prices|cost|fee|fees)\b/i.test(q)
}

function suggestFixTypeForOpportunity(row: { ctr: number; avg_position: number; query: string }): 'title_meta' | 'internal_links' | 'content_gaps' | 'schema' {
  // Very rough CTR guard: < 2% at Page‑2 is likely title/description issue
  if (row.ctr < 0.02) return 'title_meta'
  if (isQuestionLike(row.query) || shouldTargetPricing(row.query)) return 'content_gaps'
  return 'internal_links'
}

type WeeklyWin = {
  url: string
  query: string
  positionChange: number // negative is improvement
  clicksDelta: number
  impressionsDelta: number
  week2: { clicks: number; impressions: number; avg_position: number }
  week1: { clicks: number; impressions: number; avg_position: number }
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const cookieStore = cookies()
    const sb = createSupabaseSsrClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
    )
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    // Fetch last ~60 days of finalized query-page rows to allow weekly + 28‑day calcs
    const end = gscAvailableEndDate()
    const endDate = new Date(`${end}T00:00:00.000Z`)
    const startDate = new Date(endDate)
    startDate.setUTCDate(startDate.getUTCDate() - 59)
    const startYmd = startDate.toISOString().slice(0, 10)
    const endYmd = endDate.toISOString().slice(0, 10)

    const { data, error } = await sb
      .from('gsc_query_page_daily')
      .select('url, query, date, clicks, impressions, avg_position, is_final')
      .eq('site_id', siteId)
      .eq('is_final', true)
      .gte('date', startYmd)
      .lte('date', endYmd)
      .order('date', { ascending: true })
      .limit(200000)
    if (error) throw new Error(error.message)
    const rows = (data || []) as QueryPageDaily[]
    const dates = Array.from(new Set(rows.map(r => r.date))).sort()
    // Build week2 = last 7 finalized days; week1 = previous 7
    const last7 = dates.slice(-7)
    const prev7 = dates.slice(-14, -7)
    const agg = (win: string[]) => {
      type Acc = { clicks: number; impressions: number; posWeighted: number }
      const map = new Map<string, Acc>()
      for (const r of rows) {
        if (!win.includes(r.date)) continue
        const key = `${r.url}\0${r.query}`
        const acc = map.get(key) || { clicks: 0, impressions: 0, posWeighted: 0 }
        acc.clicks += Number(r.clicks) || 0
        acc.impressions += Number(r.impressions) || 0
        const pos = Number(r.avg_position) || 0
        acc.posWeighted += pos * (Number(r.impressions) || 0)
        map.set(key, acc)
      }
      const out = new Map<string, { clicks: number; impressions: number; avg_position: number }>()
      for (const [key, v] of map.entries()) {
        const avg_position = v.impressions > 0 ? v.posWeighted / v.impressions : 0
        out.set(key, {
          clicks: Math.round(v.clicks),
          impressions: Math.round(v.impressions),
          avg_position,
        })
      }
      return out
    }
    const w2 = agg(last7)
    const w1 = agg(prev7)

    const wins: WeeklyWin[] = []
    for (const [key, cur] of w2.entries()) {
      const prev = w1.get(key) || { clicks: 0, impressions: 0, avg_position: cur.avg_position }
      const [url, query] = key.split('\0')
      const deltaPos = cur.avg_position - prev.avg_position // negative is good
      const clicksDelta = cur.clicks - prev.clicks
      const impressionsDelta = cur.impressions - prev.impressions
      // Consider a "win" if position improved by >= 0.5 or clicks gained by >= 10
      if (deltaPos <= -0.5 || clicksDelta >= 10) {
        wins.push({
          url,
          query,
          positionChange: deltaPos,
          clicksDelta,
          impressionsDelta,
          week2: cur,
          week1: prev,
        })
      }
    }
    wins.sort((a, b) => {
      // Primary by position improvement magnitude, then by clicks delta
      const byPos = Math.abs(a.positionChange) - Math.abs(b.positionChange)
      if (byPos !== 0) return byPos > 0 ? -1 : 1
      return (b.clicksDelta || 0) - (a.clicksDelta || 0)
    })

    // Best next action from Page‑2 opportunities (28‑day window)
    const window = pickWindowDates(rows.map(r => r.date), 28, 90)
    let nextAction: null | {
      url: string
      query: string
      avg_position: number
      ctr: number
      suggestedFix: 'title_meta' | 'internal_links' | 'content_gaps' | 'schema'
    } = null
    if (window) {
      const opp = aggregateWindowForQueryPage(rows, window.startDate, window.endDate)[0]
      if (opp) {
        nextAction = {
          url: opp.url,
          query: opp.query,
          avg_position: opp.avg_position,
          ctr: opp.ctr,
          suggestedFix: suggestFixTypeForOpportunity(opp),
        }
      }
    }

    // Fix Receipts shipped in the last 7 days (+ optional before/after)
    const since = new Date(endDate)
    since.setUTCDate(since.getUTCDate() - 7)
    const receipts = (await listFixReceiptsForSite({ userId: user.id, siteId, limit: 50 }))
      .filter(r => {
        const t = r.productionVerifiedAt || r.previewVerifiedAt || r.createdAt
        return t ? new Date(t) >= since : false
      })
      .slice(0, 10)

    // Gather before/after where possible using url_metrics_daily
    const { data: urlDaily, error: urlErr } = await sb
      .from('url_metrics_daily')
      .select('url, date, impressions, clicks, avg_position, is_final')
      .eq('site_id', siteId)
      .gte('date', startYmd)
      .lte('date', endYmd)
      .limit(200000)
    if (urlErr) throw new Error(urlErr.message)
    type UrlRow = { url: string; date: string; impressions: number; clicks: number; avg_position: number; is_final: boolean }
    const byUrl = new Map<string, UrlRow[]>()
    for (const r of (urlDaily || []) as UrlRow[]) {
      const arr = byUrl.get(r.url) || []
      arr.push(r)
      byUrl.set(r.url, arr)
    }
    const receiptsWithBeforeAfter = receipts.map(r => {
      const appliedAt = r.productionVerifiedAt || r.previewVerifiedAt || r.createdAt
      const series = byUrl.get(r.pageUrl || '') || []
      let beforeAfter: null | ReturnType<typeof computeBeforeAfterForUrl> = null
      if (appliedAt && series.length > 0) {
        beforeAfter = computeBeforeAfterForUrl({
          url: r.pageUrl || '',
          rows: series,
          appliedAt,
          baselineDays: 28,
          observationDays: 28,
        })
      }
      return {
        ...r,
        beforeAfter,
      }
    })

    // Site-wide week-over-week totals
    const totalW2 = Array.from(w2.values()).reduce((a, v) => ({ clicks: a.clicks + v.clicks, impressions: a.impressions + v.impressions }), { clicks: 0, impressions: 0 })
    const totalW1 = Array.from(w1.values()).reduce((a, v) => ({ clicks: a.clicks + v.clicks, impressions: a.impressions + v.impressions }), { clicks: 0, impressions: 0 })

    return NextResponse.json({
      ok: true,
      siteId,
      weekEnding: endYmd,
      totals: {
        clicks: { current: totalW2.clicks, previous: totalW1.clicks, delta: totalW2.clicks - totalW1.clicks },
        impressions: { current: totalW2.impressions, previous: totalW1.impressions, delta: totalW2.impressions - totalW1.impressions },
      },
      wins: wins.slice(0, 8),
      nextAction,
      receipts: receiptsWithBeforeAfter,
    })
  } catch (err) {
    console.error('[reports/weekly]', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

