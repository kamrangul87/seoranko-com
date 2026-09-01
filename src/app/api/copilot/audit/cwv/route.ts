import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fetchCoreWebVitals } from '@/lib/core-web-vitals'
import { buildExplainableScore } from '@/lib/quality-score-dimensions'
import { isSafePublicUrl } from '@/lib/fetch-page-content'

/** PSI Lighthouse runs can exceed 60s — allow up to 120s on this dedicated route. */
export const maxDuration = 180

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })
    const pageUrl = url.startsWith('http') ? url : `https://${url}`
    if (!isSafePublicUrl(pageUrl)) {
      return NextResponse.json({ error: 'URL is not allowed' }, { status: 400 })
    }

    const cwv = await fetchCoreWebVitals(pageUrl)
    const cwvIssues = cwv.issues.map((i) => ({
      id: i.id,
      severity: i.severity,
      category: i.category,
      title: i.title,
      description: i.description,
      remediation: i.remediation,
      affectsDimensions: i.affectsDimensions,
      blocking: i.blocking ?? i.severity === 'critical',
    }))
    const explainable = buildExplainableScore(cwvIssues)
    const cwvDimension = explainable.dimensions.find((d) => d.id === 'core_web_vitals')

    const crawlNote = cwv.labFallbackUsed
      ? 'Core Web Vitals: lab data only — insufficient real-user traffic for field data (Chrome UX Report).'
      : cwv.dataMode === 'field'
        ? 'Core Web Vitals: Chrome UX Report field data from PageSpeed Insights.'
        : cwv.error
          ? `Core Web Vitals: ${cwv.error}`
          : null

    return NextResponse.json({
      ok: cwv.ok,
      coreWebVitals: {
        dataMode: cwv.dataMode,
        labFallbackUsed: cwv.labFallbackUsed,
        metrics: cwv.metrics,
        error: cwv.error,
      },
      issues: cwvIssues,
      dimension: cwvDimension,
      crawlNote,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Core Web Vitals check failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
