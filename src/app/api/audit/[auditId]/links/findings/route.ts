import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
  )
}

/** GET /api/audit/[auditId]/links/findings — paginated, filter by rule_id/severity. */
export async function GET(
  req: NextRequest,
  { params }: { params: { auditId: string } },
) {
  const supabase = authClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const ruleId = url.searchParams.get('rule_id')
  const severity = url.searchParams.get('severity')
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)

  let q = supabase
    .from('link_findings')
    .select('id, rule_id, severity, source_url, target_url, evidence, suggested_target, created_at', {
      count: 'exact',
    })
    .eq('audit_id', params.auditId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (ruleId) q = q.eq('rule_id', ruleId)
  if (severity) q = q.eq('severity', severity)

  const { data, error, count } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({
    ok: true,
    findings: data || [],
    total: count ?? 0,
    limit,
    offset,
  })
}
