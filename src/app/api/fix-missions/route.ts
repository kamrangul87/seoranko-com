import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  createFixMission,
  getLatestFixMissionForSite,
} from '@/lib/fix-strategies/fix-mission'

export const dynamic = 'force-dynamic'

async function authUser() {
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

/**
 * GET /api/fix-missions?siteId=…
 * Latest planned mission for the site (overview persistence across refresh).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const siteId = req.nextUrl.searchParams.get('siteId')
    if (!siteId) {
      return NextResponse.json({ error: 'siteId required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }

    const mission = await getLatestFixMissionForSite(siteId, user.id)
    return NextResponse.json({ ok: true, mission })
  } catch (err) {
    console.error('[fix-missions GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load mission' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/fix-missions { siteId }
 * Classify latest-crawl actionable findings into a planned mission.
 * Does NOT start a fix, open a branch, or create a PR.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await authUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await req.json().catch(() => ({}))) as { siteId?: string }
    const siteId = body.siteId
    if (!siteId) {
      return NextResponse.json({ error: 'siteId required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }

    const mission = await createFixMission({
      userId: user.id,
      siteId: site.id,
      siteDomain: site.domain,
    })

    return NextResponse.json({
      ok: true,
      mission,
      // Explicit: this endpoint never mutates customer repos.
      wroteToCustomerRepo: false,
    })
  } catch (err) {
    console.error('[fix-missions POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create mission' },
      { status: 500 },
    )
  }
}
