import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { loadLinkGraphSummary } from '@/lib/link-graph/persist'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
  )
}

/** GET /api/audit/[auditId]/links — summary + top findings (RLS-scoped). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { auditId: string } },
) {
  const supabase = authClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const summary = await loadLinkGraphSummary(supabase, params.auditId)
  if (!summary) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true, ...summary })
}
