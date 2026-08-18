import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { verifyOnePage } from '@/lib/publisher-verification-runner'
import { verifyOnePublication } from '@/lib/publish-verification'

// On-demand check for one page/publication — lets a client that's actively
// watching a just-published article poll faster than the cron sweep's
// interval. The relevant cron sweep (/api/cron/verify-liveness for
// pageId, /api/cron/verify-publications for publicationId) is the
// reliable fallback either way.
export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    if (body.publicationId) {
      // Ownership check — the hosted state machine has no per-row
      // liveness_state auth gate the way pages does, so verify here.
      const { data: pub } = await supabase
        .from('publications')
        .select('id, user_id, state')
        .eq('id', body.publicationId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!pub) return NextResponse.json({ success: false, message: 'Publication not found.' }, { status: 404 })
      if (pub.state !== 'LIVE_UNVERIFIED') {
        return NextResponse.json({ success: true, message: `Nothing to verify — publication is already ${pub.state}.`, state: pub.state })
      }

      const { verified, report } = await verifyOnePublication(supabase, body.publicationId)
      const nowIso = new Date().toISOString()
      if (verified) {
        await supabase.from('publications').update({ state: 'LIVE_VERIFIED', verified_at: nowIso, verification_report: report }).eq('id', body.publicationId)
      } else {
        await supabase.from('publications').update({ verification_report: report }).eq('id', body.publicationId)
      }
      return NextResponse.json({ success: true, verified, state: verified ? 'LIVE_VERIFIED' : 'LIVE_UNVERIFIED', report })
    }

    const { pageId } = body
    if (!pageId) return NextResponse.json({ success: false, message: 'pageId or publicationId is required.' }, { status: 400 })

    const result = await verifyOnePage(supabase, pageId, user.id)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error('[publish/verify]', error)
    return NextResponse.json({ success: false, message: String(error) }, { status: 500 })
  }
}
