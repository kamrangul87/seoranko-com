import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fixListToCsv } from '@/lib/link-graph/fix-list'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
  )
}

const FIX_LIST_RULES = ['L04', 'L05', 'L06', 'L17', 'L18', 'L19', 'L27', 'L29']

/** GET /api/audit/[auditId]/links/export?format=csv|json */
export async function GET(
  req: NextRequest,
  { params }: { params: { auditId: string } },
) {
  const supabase = authClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const format = new URL(req.url).searchParams.get('format') || 'json'

  const { data: findings, error } = await supabase
    .from('link_findings')
    .select('rule_id, source_url, target_url, suggested_target, evidence')
    .eq('audit_id', params.auditId)
    .in('rule_id', FIX_LIST_RULES)
    .not('suggested_target', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = (findings || []).map((f) => ({
    source_url: f.source_url || '',
    current_href: (f.evidence as { hrefRaw?: string })?.hrefRaw || f.target_url || '',
    suggested_href: f.suggested_target as string,
    rule_id: f.rule_id as string,
    reason: f.rule_id as string,
    dom_region: 'unknown',
  }))

  if (format === 'csv') {
    const csv = fixListToCsv(rows)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="link-fix-list-${params.auditId}.csv"`,
      },
    })
  }

  return NextResponse.json({ ok: true, rows })
}
