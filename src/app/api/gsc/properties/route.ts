import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { decryptGscRefreshToken, refreshGscAccessToken } from '@/lib/gsc/oauth'
import { listGscSites } from '@/lib/gsc/client'
import { domainFromGscPropertyUrl } from '@/lib/gsc/property-domain'
import { normaliseDomain } from '@/lib/connected-sites'

export const dynamic = 'force-dynamic'

/**
 * GET — list Search Console properties.
 * - No siteId → use gsc_accounts (onboarding checklist) + annotate already-tracked hosts
 * - siteId → use that site's gsc_connections token
 */
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
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    if (!siteId) {
      const { data: account } = await supabase
        .from('gsc_accounts')
        .select('id, refresh_token_encrypted, status')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!account) {
        return NextResponse.json(
          { error: 'Connect Google Search Console first.', code: 'not_connected' },
          { status: 400 },
        )
      }

      try {
        const refreshToken = decryptGscRefreshToken(account.refresh_token_encrypted)
        const { accessToken } = await refreshGscAccessToken(refreshToken)
        const properties = await listGscSites(accessToken)

        const { data: sites } = await supabase
          .from('connected_sites')
          .select('id, domain')
          .eq('user_id', user.id)
        const { data: conns } = await supabase
          .from('gsc_connections')
          .select('site_id, property_url')
          .eq('user_id', user.id)

        const siteById = new Map((sites || []).map((s: { id: string; domain: string }) => [s.id, s]))
        const trackedByProperty = new Map<string, { siteId: string; domain: string }>()
        for (const c of conns || []) {
          if (!c.property_url) continue
          const site = siteById.get(c.site_id)
          if (site) {
            trackedByProperty.set(c.property_url, { siteId: site.id, domain: site.domain })
          }
        }
        const domainsWithSites = new Set(
          (sites || []).map((s: { domain: string }) => normaliseDomain(s.domain)),
        )

        return NextResponse.json({
          ok: true,
          mode: 'account',
          status: account.status,
          properties: properties.map((p) => {
            const domain = domainFromGscPropertyUrl(p.siteUrl)
            const tracked = trackedByProperty.get(p.siteUrl)
            const siteExists = domain ? domainsWithSites.has(domain) : false
            return {
              ...p,
              domain,
              alreadyTracked: !!tracked,
              siteExists,
              trackedSiteId: tracked?.siteId || null,
            }
          }),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not list properties'
        if (/expired|invalid_grant|401/i.test(message)) {
          await supabase
            .from('gsc_accounts')
            .update({ status: 'expired', last_error: message })
            .eq('id', account.id)
        }
        return NextResponse.json({ error: message, code: 'gsc_list_failed' }, { status: 400 })
      }
    }

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
        mode: 'site',
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
