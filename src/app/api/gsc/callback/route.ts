import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  encryptGscRefreshToken,
  exchangeGscAuthCode,
  verifyGscOAuthState,
} from '@/lib/gsc/oauth'
import { decideGscRefreshTokenApply } from '@/lib/gsc/callback-token'

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
 * Account mode → store token on gsc_accounts → pick properties checklist.
 * Site mode → store token on gsc_connections → pick one property for that site
 *   (or return to Experiments when the property mapping is already known).
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

    if (parsed.mode === 'account') {
      const { data: existing } = await supabase
        .from('gsc_accounts')
        .select('id, refresh_token_encrypted, status')
        .eq('user_id', parsed.userId)
        .maybeSingle()

      const decision = decideGscRefreshTokenApply({
        newRefreshToken: tokens.refreshToken,
        existingCiphertext: existing?.refresh_token_encrypted,
        existingStatus: existing?.status,
      })

      if (decision.action === 'reject') {
        return NextResponse.redirect(
          `${origin}/dashboard/experiments?gsc_error=${encodeURIComponent(decision.message)}`,
        )
      }

      if (decision.action === 'store_new') {
        const encrypted = encryptGscRefreshToken(decision.refreshToken)
        const { error } = await supabase.from('gsc_accounts').upsert(
          {
            user_id: parsed.userId,
            refresh_token_encrypted: encrypted,
            status: 'active',
            connected_at: new Date().toISOString(),
            last_error: null,
          },
          { onConflict: 'user_id' },
        )
        if (error) throw new Error(error.message)
      } else if (existing?.id) {
        await supabase
          .from('gsc_accounts')
          .update({ status: 'active', last_error: null, connected_at: new Date().toISOString() })
          .eq('id', existing.id)
      }

      return NextResponse.redirect(`${origin}/dashboard/experiments?gsc=pick_properties`)
    }

    // Site mode (reconnect / attach to one existing connected_sites row)
    const siteId = parsed.siteId!
    const { data: existing } = await supabase
      .from('gsc_connections')
      .select('id, refresh_token_encrypted, status, property_url')
      .eq('site_id', siteId)
      .eq('user_id', parsed.userId)
      .maybeSingle()

    const decision = decideGscRefreshTokenApply({
      newRefreshToken: tokens.refreshToken,
      existingCiphertext: existing?.refresh_token_encrypted,
      existingStatus: existing?.status,
    })

    if (decision.action === 'reject') {
      return NextResponse.redirect(
        `${origin}/dashboard/experiments?siteId=${encodeURIComponent(siteId)}&gsc_error=${encodeURIComponent(
          decision.message,
        )}`,
      )
    }

    const existingPropertyUrl = existing?.property_url || null

    if (decision.action === 'store_new') {
      const encrypted = encryptGscRefreshToken(decision.refreshToken)
      const { error } = await supabase.from('gsc_connections').upsert(
        {
          user_id: parsed.userId,
          site_id: siteId,
          refresh_token_encrypted: encrypted,
          status: 'active',
          connected_at: new Date().toISOString(),
          last_error: null,
          // Preserve an existing property mapping on reconnect — do not force re-pick.
          property_url: existingPropertyUrl,
        },
        { onConflict: 'site_id' },
      )
      if (error) throw new Error(error.message)
    } else if (existing?.id) {
      await supabase
        .from('gsc_connections')
        .update({ status: 'active', last_error: null, connected_at: new Date().toISOString() })
        .eq('id', existing.id)
    }

    if (existingPropertyUrl) {
      return NextResponse.redirect(
        `${origin}/dashboard/experiments?siteId=${encodeURIComponent(siteId)}&gsc=reconnected`,
      )
    }

    return NextResponse.redirect(
      `${origin}/dashboard/experiments?siteId=${encodeURIComponent(siteId)}&gsc=pick_property`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GSC OAuth failed'
    console.error('[gsc/callback]', message)
    return NextResponse.redirect(
      `${origin}/dashboard/experiments?gsc_error=${encodeURIComponent(message)}`,
    )
  }
}
