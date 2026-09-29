import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import {
  buildShareableReport,
  renderReportText,
} from '@/lib/fix-strategies/findings-ui/share-report'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/fix-report/[token]?from=&to=&format=json|text
 * No login. Keyed by connected_sites.report_share_token — never the raw
 * site UUID (same pattern as /api/universal-tag/[siteToken]). Exposes
 * only that one site's findings/fix data, nothing else about the account.
 * Revoking is the owner nulling the token (see /api/fix-strategies/reports/token).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  if (!params.token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: site } = await supabase
    .from('connected_sites')
    .select('id, domain')
    .eq('report_share_token', params.token)
    .maybeSingle()

  if (!site) {
    return NextResponse.json({ error: 'Report link not found or revoked' }, { status: 404 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const format = url.searchParams.get('format') === 'text' ? 'text' : 'json'

  const store = getFindingsStore()
  const report = await buildShareableReport({
    siteId: site.id,
    origin: `https://${site.domain}`,
    from,
    to,
    store,
  })

  if (format === 'text') {
    return new NextResponse(renderReportText(report), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  return NextResponse.json(report)
}
