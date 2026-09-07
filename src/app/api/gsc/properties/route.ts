import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { decryptGscRefreshToken, refreshGscAccessToken } from '@/lib/gsc/oauth'
import { listGscSites } from '@/lib/gsc/client'

export const dynamic = 'force-dynamic'

/** GET ?siteId= — list Search Console properties the connected account can access. */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: conn } = await supabase
      .from('gsc_connections')
      .select('id, refresh_token_encrypted, status, property_url')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!conn) {
      return NextResponse.json(
        { error: 'Connect Google Search Console first.', code: 'not_connected' },
        { status: 400 },
      )
    }

    try {
      const refreshToken = decryptGscRefreshToken(conn.refresh_token_encrypted)
      const { accessToken } = await refreshGscAccessToken(refreshToken)
      const properties = await listGscSites(accessToken)
      return NextResponse.json({
        ok: true,
        properties,
        selectedPropertyUrl: conn.property_url,
        status: conn.status,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not list properties'
      if (/expired|invalid_grant|401/i.test(message)) {
        await supabase
          .from('gsc_connections')
          .update({ status: 'expired', last_error: message })
          .eq('id', conn.id)
      }
      return NextResponse.json({ error: message, code: 'gsc_list_failed' }, { status: 400 })
    }
  } catch (err) {
    console.error('[gsc/properties]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not list Search Console properties' }, { status: 500 })
  }
}
