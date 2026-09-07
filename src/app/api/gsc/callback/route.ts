import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  encryptGscRefreshToken,
  exchangeGscAuthCode,
  verifyGscOAuthState,
} from '@/lib/gsc/oauth'

function appOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  if (host) return `${proto}://${host}`
  return 'https://www.seoranko.com'
}

/**
 * Google OAuth redirect target.
 * Exchanges code → stores encrypted refresh token → redirects to Experiments UI
 * to pick a property.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req)
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')

  if (oauthError) {
    const desc = req.nextUrl.searchParams.get('error_description') || oauthError
    return NextResponse.redirect(
      `${origin}/dashboard/experiments?gsc_error=${encodeURIComponent(desc)}`,
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/dashboard/experiments?gsc_error=${encodeURIComponent('Missing OAuth code or state')}`,
    )
  }

  try {
    const parsed = verifyGscOAuthState(state)
    const tokens = await exchangeGscAuthCode(code)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    if (!tokens.refreshToken) {
      const { data: existing } = await supabase
        .from('gsc_connections')
        .select('id, refresh_token_encrypted')
        .eq('site_id', parsed.siteId)
        .eq('user_id', parsed.userId)
        .maybeSingle()

      if (!existing?.refresh_token_encrypted) {
        return NextResponse.redirect(
          `${origin}/dashboard/experiments?siteId=${encodeURIComponent(parsed.siteId)}&gsc_error=${encodeURIComponent(
            'Google did not return a refresh token. Revoke SEORANKO access in your Google Account and connect again with consent.',
          )}`,
        )
      }

      await supabase
        .from('gsc_connections')
        .update({ status: 'active', last_error: null, connected_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      const encrypted = encryptGscRefreshToken(tokens.refreshToken)
      const { error } = await supabase.from('gsc_connections').upsert(
        {
          user_id: parsed.userId,
          site_id: parsed.siteId,
          refresh_token_encrypted: encrypted,
          status: 'active',
          connected_at: new Date().toISOString(),
          last_error: null,
          property_url: null,
        },
        { onConflict: 'site_id' },
      )
      if (error) throw new Error(error.message)
    }

    return NextResponse.redirect(
      `${origin}/dashboard/experiments?siteId=${encodeURIComponent(parsed.siteId)}&gsc=pick_property`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GSC OAuth failed'
    console.error('[gsc/callback]', message)
    return NextResponse.redirect(
      `${origin}/dashboard/experiments?gsc_error=${encodeURIComponent(message)}`,
    )
  }
}
