import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import {
  buildGscAuthorizeUrl,
  decryptGscRefreshToken,
  refreshGscAccessToken,
  requireGscOAuthConfig,
  signGscOAuthState,
} from '@/lib/gsc/oauth'
import { listGscSites } from '@/lib/gsc/client'
import { syncGscConnection } from '@/lib/gsc/sync'

export const maxDuration = 60

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireUser() {
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
 * GET — start OAuth or return status.
 * - No siteId + action=connect → account-level onboarding OAuth
 * - siteId + action=connect → reconnect / attach for one existing site
 * - No siteId + action=status → gsc_accounts status
 * - siteId + action=status (default) → per-site gsc_connections status
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    const action = req.nextUrl.searchParams.get('action') || 'status'
    const supabase = serviceClient()

    if (action === 'connect') {
      try {
        requireGscOAuthConfig()
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'GSC OAuth is not configured' },
          { status: 503 },
        )
      }

      if (siteId) {
        const { data: site } = await supabase
          .from('connected_sites')
          .select('id')
          .eq('id', siteId)
          .eq('user_id', user.id)
          .maybeSingle()
        if (!site) {
          return NextResponse.json({ error: 'Site not found' }, { status: 404 })
        }
        const state = signGscOAuthState({
          userId: user.id,
          mode: 'site',
          siteId,
          nonce: randomBytes(8).toString('hex'),
          exp: Date.now() + 15 * 60 * 1000,
        })
        return NextResponse.json({ ok: true, authorizeUrl: buildGscAuthorizeUrl(state), mode: 'site' })
      }

      const state = signGscOAuthState({
        userId: user.id,
        mode: 'account',
        nonce: randomBytes(8).toString('hex'),
        exp: Date.now() + 15 * 60 * 1000,
      })
      return NextResponse.json({
        ok: true,
        authorizeUrl: buildGscAuthorizeUrl(state),
        mode: 'account',
      })
    }

    // Status
    if (!siteId) {
      const { data: account } = await supabase
        .from('gsc_accounts')
        .select('id, status, connected_at, last_error')
        .eq('user_id', user.id)
        .maybeSingle()
      return NextResponse.json({ ok: true, account: account || null })
    }

    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain, brand, user_id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }

    const { data: conn } = await supabase
      .from('gsc_connections')
      .select('id, property_url, status, connected_at, last_sync_at, last_error')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    return NextResponse.json({
      ok: true,
      site: { id: site.id, domain: site.domain, brand: site.brand },
      connection: conn || null,
    })
  } catch (err) {
    console.error('[gsc/connect GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not load GSC connection' }, { status: 500 })
  }
}

/** POST — save selected property_url on an existing site and kick off backfill */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    const propertyUrl = typeof body.propertyUrl === 'string' ? body.propertyUrl.trim() : ''
    if (!siteId || !propertyUrl) {
      return NextResponse.json({ error: 'siteId and propertyUrl are required' }, { status: 400 })
    }

    const supabase = serviceClient()
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: conn } = await supabase
      .from('gsc_connections')
      .select('id, refresh_token_encrypted, status')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!conn) {
      return NextResponse.json(
        { error: 'Connect Google Search Console before selecting a property.' },
        { status: 400 },
      )
    }

    // Verify the user can see this property (not a verified owner → clear message).
    try {
      const refreshToken = decryptGscRefreshToken(conn.refresh_token_encrypted)
      const { accessToken } = await refreshGscAccessToken(refreshToken)
      const sites = await listGscSites(accessToken)
      const match = sites.find((s) => s.siteUrl === propertyUrl)
      if (!match) {
        return NextResponse.json(
          {
            error:
              'You are not a verified owner of that Search Console property (or it is not in your account). ' +
              'Pick a property you own, or ask a verified owner to grant you access.',
            code: 'not_verified_owner',
            properties: sites.map((s) => s.siteUrl),
          },
          { status: 403 },
        )
      }
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : 'Could not verify Search Console property access',
          code: 'gsc_verify_failed',
        },
        { status: 400 },
      )
    }

    await supabase
      .from('gsc_connections')
      .update({
        property_url: propertyUrl,
        status: 'active',
        last_error: null,
      })
      .eq('id', conn.id)

    const sync = await syncGscConnection(supabase, conn.id, { fullBackfill: true })

    return NextResponse.json({ ok: true, connectionId: conn.id, propertyUrl, sync })
  } catch (err) {
    console.error('[gsc/connect POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save Search Console property' }, { status: 500 })
  }
}
