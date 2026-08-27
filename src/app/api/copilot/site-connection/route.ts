import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getSiteConnectionStatus } from '@/lib/site-connection-lookup'

/** GET ?url= — whether the audited URL has an active owned site connection (no secrets). */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = req.nextUrl.searchParams.get('url') || ''
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const status = await getSiteConnectionStatus(supabase, user.id, url)
    return NextResponse.json({ ok: true, ...status })
  } catch (err) {
    console.error('[site-connection]', err)
    return NextResponse.json({ error: 'Connection lookup failed' }, { status: 500 })
  }
}
