import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { decryptGscRefreshToken, refreshGscAccessToken } from '@/lib/gsc/oauth'
import { listGscSites } from '@/lib/gsc/client'
import { registerGscPropertiesForUser } from '@/lib/gsc/register-properties'
import { syncGscConnection } from '@/lib/gsc/sync'

export const maxDuration = 60

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * POST { propertyUrls: string[] }
 * Account-level onboarding: create connected_sites + gsc_connections for each
 * selected Search Console property (token copied from gsc_accounts).
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json().catch(() => ({}))
    const propertyUrls = Array.isArray(body.propertyUrls)
      ? body.propertyUrls.filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
      : []
    if (propertyUrls.length === 0) {
      return NextResponse.json({ error: 'propertyUrls is required' }, { status: 400 })
    }
    if (propertyUrls.length > 50) {
      return NextResponse.json({ error: 'Select at most 50 properties at once' }, { status: 400 })
    }

    const supabase = serviceClient()
    const { data: account } = await supabase
      .from('gsc_accounts')
      .select('id, refresh_token_encrypted, status')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!account?.refresh_token_encrypted) {
      return NextResponse.json(
        {
          error: 'Connect Google Search Console first, then select properties to track.',
          code: 'not_connected',
        },
        { status: 400 },
      )
    }

    let allowed: Set<string>
    try {
      const refreshToken = decryptGscRefreshToken(account.refresh_token_encrypted)
      const { accessToken } = await refreshGscAccessToken(refreshToken)
      const sites = await listGscSites(accessToken)
      allowed = new Set(sites.map((s) => s.siteUrl))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not verify Search Console access'
      if (/expired|invalid_grant|401/i.test(message)) {
        await supabase
          .from('gsc_accounts')
          .update({ status: 'expired', last_error: message })
          .eq('id', account.id)
      }
      return NextResponse.json({ error: message, code: 'gsc_verify_failed' }, { status: 400 })
    }

    const result = await registerGscPropertiesForUser(supabase, {
      userId: user.id,
      propertyUrls,
      refreshTokenEncrypted: account.refresh_token_encrypted,
      allowedPropertyUrls: allowed,
    })

    // Backfill the first newly mapped connection in this request; remaining sites
    // pick up on Sync now or the daily gsc-sync cron (Hobby: once daily).
    let sync: Awaited<ReturnType<typeof syncGscConnection>> | null = null
    const first = result.registered[0]
    if (first) {
      sync = await syncGscConnection(supabase, first.connectionId, { fullBackfill: true })
    }

    return NextResponse.json({
      ok: true,
      registered: result.registered,
      skipped: result.skipped,
      sync,
      syncNote:
        result.registered.length > 1
          ? 'Backfilled the first selected property in this request. Use Sync now on each other site, or wait for the daily GSC sync.'
          : undefined,
    })
  } catch (err) {
    console.error('[gsc/register]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not register Search Console properties' }, { status: 500 })
  }
}
