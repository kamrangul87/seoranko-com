import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { verifyOnePage } from '@/lib/publisher-verification-runner'

// On-demand liveness check for one page — lets a client that's actively
// watching a just-published article poll faster than the cron sweep's
// interval, for the short early backoff steps (30s/1m/2m). The cron sweep
// (/api/cron/verify-liveness) is the reliable fallback for longer steps a
// client isn't realistically still polling for.
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

    const { pageId } = await req.json()
    if (!pageId) return NextResponse.json({ success: false, message: 'pageId is required.' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const result = await verifyOnePage(supabase, pageId, user.id)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error('[publish/verify]', error)
    return NextResponse.json({ success: false, message: String(error) }, { status: 500 })
  }
}
