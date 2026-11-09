import { NextResponse, NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { gscAvailableEndDate } from '@/lib/gsc/client'
import type { QueryPageDaily } from '@/lib/gsc/opportunities'
import {
  bestPage2NextAction,
  pickLatestCompleteWeek,
  previousWeekDates,
  weeklyTotalsFromRows,
} from '@/lib/gsc/weekly-report'
import { listFixReceiptsForSite } from '@/lib/fix-strategies/findings-ui/fix-receipt'
import { dedupeFixReceipts } from '@/lib/fix-strategies/findings-ui/fix-receipt-display'
import { ownerFacingVerdictTitle } from '@/lib/fix-strategies/findings-ui/owner-copy'
import { computeBeforeAfterForUrl } from '@/lib/gsc/before-after'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type WeeklyWin = {
  url: string
  query: string
  positionChange: number
  clicksDelta: number
  impressionsDelta: number
  week2: { clicks: number; impressions: number; avg_position: number }
  week1: { clicks: number; impressions: number; avg_position: number }
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const cookieStore = cookies()
    const userClient = createSupabaseSsrClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const { data: site, error: siteErr } = await userClient
      .from('connected_sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (siteErr || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }

    // Service role: gsc_query_page_daily has RLS with no authenticated policy.
    const sb = createServiceRoleClient()

    const end = gscAvailableEndDate()
    const endDate = new Date(`${end}T00:00:00.000Z`)
    const startDate = new Date(endDate)
    startDate.setUTCDate(startDate.getUTCDate() - 90)
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
    const weekBundle = weeklyTotalsFromRows(rows)
    const week = weekBundle?.week ?? pickLatestCompleteWeek(rows.map((r) => r.date))
    const last7 = week?.dates ?? []
    const prev7 = week ? previousWeekDates(week) : []
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
      const deltaPos = cur.avg_position - prev.avg_position
      const clicksDelta = cur.clicks - prev.clicks
      const impressionsDelta = cur.impressions - prev.impressions
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
      const byPos = Math.abs(a.positionChange) - Math.abs(b.positionChange)
      if (byPos !== 0) return byPos > 0 ? -1 : 1
      return (b.clicksDelta || 0) - (a.clicksDelta || 0)
    })

    const nextAction = bestPage2NextAction(rows)

    const since = week
      ? new Date(`${week.startDate}T00:00:00.000Z`)
      : (() => {
          const d = new Date(endDate)
          d.setUTCDate(d.getUTCDate() - 7)
          return d
        })()
    const receipts = dedupeFixReceipts(
      (await listFixReceiptsForSite({ userId: user.id, siteId, limit: 50 }))
        .filter((r) => {
          const t = r.productionVerifiedAt || r.previewVerifiedAt || r.createdAt
          return t ? new Date(t) >= since : false
        })
        .slice(0, 10),
    )

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
    const receiptsWithBeforeAfter = receipts.map((r) => {
      const appliedAt = r.productionVerifiedAt || r.previewVerifiedAt || r.createdAt
      const displayUrl = r.pageUrl || ''
      const series = byUrl.get(displayUrl) || []
      let beforeAfter: null | ReturnType<typeof computeBeforeAfterForUrl> = null
      if (appliedAt && series.length > 0) {
        beforeAfter = computeBeforeAfterForUrl({
          url: displayUrl,
          rows: series,
          appliedAt,
          baselineDays: 28,
          observationDays: 28,
        })
      }
      return {
        ...r,
        title: r.plainEnglish || ownerFacingVerdictTitle(r.verdict),
        beforeAfter,
      }
    })

    const totals = weekBundle?.totals ?? {
      clicks: { current: 0, previous: 0, delta: 0 },
      impressions: { current: 0, previous: 0, delta: 0 },
    }

    return NextResponse.json({
      ok: true,
      siteId,
      weekEnding: week?.weekEnding ?? null,
      weekStart: week?.startDate ?? null,
      weekEnd: week?.endDate ?? null,
      totals,
      wins: wins.slice(0, 8),
      nextAction,
      receipts: receiptsWithBeforeAfter,
    })
  } catch (err) {
    console.error('[reports/weekly]', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
