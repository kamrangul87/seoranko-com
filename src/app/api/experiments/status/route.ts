import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { syncGscConnection } from '@/lib/gsc/sync'
import { evaluateBaselineReadiness, reasonCodeLabel, type BaselineReasonCode } from '@/lib/gsc/baseline-readiness'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireUser() {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const {
    data: { user },
  } = await authClient.auth.getUser()
  return user
}

/** GET ?siteId= — connection + readiness + baseline summary for Experiments UI. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const supabase = serviceClient()
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain, brand')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: connection } = await supabase
      .from('gsc_connections')
      .select('id, property_url, status, connected_at, last_sync_at, last_error')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    const { data: readinessRows } = await supabase
      .from('baseline_readiness_checks')
      .select('id, passed, reason_code, evidence, checked_at')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .order('checked_at', { ascending: false })
      .limit(1)

    const readiness = readinessRows?.[0] || null

    let metricsSummary: {
      urlCount: number
      dayCount: number
      totalImpressions: number
      totalClicks: number
      medianAvgPosition: number | null
      baselineStart: string | null
      baselineEnd: string | null
      provisionalRowCount: number
    } | null = null

    if (connection?.property_url) {
      const { data: metrics } = await supabase
        .from('url_metrics_daily')
        .select('url, date, impressions, clicks, avg_position, is_final')
        .eq('site_id', siteId)

      const finalRows = (metrics || []).filter((m) => m.is_final)
      const urls = new Set(finalRows.map((m) => m.url))
      const days = new Set(finalRows.map((m) => m.date))
      const positions = finalRows
        .filter((m) => m.impressions > 0)
        .map((m) => Number(m.avg_position))
        .sort((a, b) => a - b)
      const mid = Math.floor(positions.length / 2)
      const medianAvgPosition =
        positions.length === 0
          ? null
          : positions.length % 2 === 0
            ? (positions[mid - 1] + positions[mid]) / 2
            : positions[mid]
      const dates = Array.from(days).sort()
      metricsSummary = {
        urlCount: urls.size,
        dayCount: days.size,
        totalImpressions: finalRows.reduce((s, m) => s + (m.impressions || 0), 0),
        totalClicks: finalRows.reduce((s, m) => s + (m.clicks || 0), 0),
        medianAvgPosition,
        baselineStart: dates[0] || null,
        baselineEnd: dates[dates.length - 1] || null,
        provisionalRowCount: (metrics || []).filter((m) => !m.is_final).length,
      }

      // If no stored readiness yet but we have metrics, compute live (do not insert here).
      if (!readiness && finalRows.length > 0) {
        const live = evaluateBaselineReadiness(finalRows)
        return NextResponse.json({
          ok: true,
          site,
          connection,
          readiness: {
            passed: live.passed,
            reason_code: live.reasonCode,
            reasonLabel: reasonCodeLabel(live.reasonCode),
            evidence: live.evidence,
            checked_at: null,
            persisted: false,
          },
          metricsSummary,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      site,
      connection: connection || null,
      readiness: readiness
        ? {
            passed: readiness.passed,
            reason_code: readiness.reason_code,
            reasonLabel: reasonCodeLabel(readiness.reason_code as BaselineReasonCode),
            evidence: readiness.evidence,
            checked_at: readiness.checked_at,
            persisted: true,
          }
        : null,
      metricsSummary,
    })
  } catch (err) {
    console.error('[experiments GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not load experiment status' }, { status: 500 })
  }
}

/** POST { siteId, action: 'sync' | 'recheck' } — manual sync / readiness recompute */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    const action = typeof body.action === 'string' ? body.action : 'sync'
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const supabase = serviceClient()
    const { data: conn } = await supabase
      .from('gsc_connections')
      .select('id, property_url')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!conn?.property_url) {
      return NextResponse.json(
        { error: 'Connect Search Console and select a property first.' },
        { status: 400 },
      )
    }

    if (action === 'sync' || action === 'backfill') {
      const sync = await syncGscConnection(supabase, conn.id, {
        fullBackfill: action === 'backfill',
      })
      return NextResponse.json({ ok: !sync.error, sync })
    }

    if (action === 'recheck') {
      const { data: metrics } = await supabase
        .from('url_metrics_daily')
        .select('url, date, impressions, clicks, avg_position, is_final')
        .eq('site_id', siteId)
        .eq('is_final', true)
      const readiness = evaluateBaselineReadiness(metrics || [])
      const { data: inserted } = await supabase
        .from('baseline_readiness_checks')
        .insert({
          site_id: siteId,
          user_id: user.id,
          passed: readiness.passed,
          reason_code: readiness.reasonCode,
          evidence: readiness.evidence,
        })
        .select('id, checked_at')
        .maybeSingle()
      return NextResponse.json({
        ok: true,
        readiness: {
          ...readiness,
          reasonLabel: reasonCodeLabel(readiness.reasonCode),
          checked_at: inserted?.checked_at || null,
        },
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[experiments POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Experiment action failed' }, { status: 500 })
  }
}
