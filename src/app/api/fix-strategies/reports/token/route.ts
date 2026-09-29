import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const dynamic = 'force-dynamic'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
}

/**
 * POST /api/fix-strategies/reports/token  { siteId }
 * Generates (or rotates) this site's shareable-report token. Owner-only —
 * verified against connected_sites.user_id, same as every other
 * site-scoped route in this app.
 *
 * DELETE /api/fix-strategies/reports/token  { siteId }
 * Revokes it (nulls the column) — the public link stops working
 * immediately, same request cycle, no cache to wait out.
 */
export async function POST(req: NextRequest) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteId } = (await req.json().catch(() => ({}))) as { siteId?: string }
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

  const admin = createServiceRoleClient()
  const { data: site } = await admin
    .from('connected_sites')
    .select('id')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const token = randomUUID()
  const { error } = await admin
    .from('connected_sites')
    .update({ report_share_token: token })
    .eq('id', siteId)
  if (error) {
    return NextResponse.json({ error: 'Could not create the share link' }, { status: 500 })
  }

  return NextResponse.json({ token, shareUrl: `/report/${token}` })
}

export async function DELETE(req: NextRequest) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteId } = (await req.json().catch(() => ({}))) as { siteId?: string }
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

  const admin = createServiceRoleClient()
  const { data: site } = await admin
    .from('connected_sites')
    .select('id')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const { error } = await admin
    .from('connected_sites')
    .update({ report_share_token: null })
    .eq('id', siteId)
  if (error) {
    return NextResponse.json({ error: 'Could not revoke the share link' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
