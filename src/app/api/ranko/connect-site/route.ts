/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getAdapter, SUPPORTED_PLATFORMS } from '@/lib/site-adapters'
import { detectSeoPlugin, normaliseSiteUrl } from '@/lib/wordpress-connector'
import { encryptCredentialsJson } from '@/lib/site-connection-crypto'

export const maxDuration = 60

// Generic connect endpoint for every platform. Credentials are verified via
// the adapter before anything is stored, and land in the `credentials` JSONB
// column, which is REVOKEd from browser roles.
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

    const { siteId, domain, platform: rawPlatform, credentials } = await req.json()

    if (!siteId || !rawPlatform) {
      return NextResponse.json({ success: false, message: 'Site and platform are required.' }, { status: 400 })
    }

    // detectCMS returns 'unknown' when the site isn't WordPress/Shopify/Webflow.
    // That is precisely the Universal Tag's job, so map the detection result to
    // the adapter name rather than rejecting it — matching getAdapter()'s
    // default case, which already routes anything unrecognised to that adapter.
    const platform = rawPlatform === 'unknown' ? 'universal-tag' : rawPlatform

    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      return NextResponse.json({ success: false, message: `Unsupported platform: ${rawPlatform}` }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!site) return NextResponse.json({ success: false, message: 'Site not found.' }, { status: 404 })

    const siteUrl = normaliseSiteUrl(domain || site.domain)
    if (!siteUrl) {
      return NextResponse.json({ success: false, message: 'That domain cannot be connected.' }, { status: 400 })
    }

    const creds = { siteUrl, siteId, ...(credentials || {}) }
    const adapter = getAdapter(platform, supabase)

    // Never store a credential we haven't proven works.
    const check = await adapter.verifyConnection(creds)
    if (!check.success) {
      return NextResponse.json({ success: false, message: check.error })
    }

    // WordPress-only extra: which SEO plugin is present changes the advice.
    let seoPlugin: string | null = null
    if (platform === 'wordpress') {
      seoPlugin = await detectSeoPlugin({
        siteUrl,
        username: credentials?.username || '',
        appPassword: credentials?.appPassword || ''
      })
    }

    // Encrypt at rest. Keep credentials JSONB as a non-secret pointer so
    // older readers that only check "is credentials set?" still work;
    // plaintext secrets live only in credentials_ciphertext.
    const credPayload = credentials && typeof credentials === 'object' ? credentials : {}
    let ciphertext: string
    try {
      ciphertext = encryptCredentialsJson(credPayload as Record<string, unknown>)
    } catch (err) {
      console.error('[connect-site] encrypt failed', err)
      return NextResponse.json(
        { success: false, message: 'Could not encrypt credentials — check SITE_CONNECTION_ENCRYPTION_KEY.' },
        { status: 500 },
      )
    }

    const { error } = await supabase.from('site_connections').upsert({
      site_id: siteId,
      user_id: user.id,
      cms_type: platform,
      // Username kept for display; password cleared from plaintext columns.
      wp_username: platform === 'wordpress' ? (credentials?.username ?? null) : null,
      wp_app_password: platform === 'wordpress' ? '' : null,
      credentials: { __ciphertext: ciphertext, __encrypted: true },
      credentials_ciphertext: ciphertext,
      detected_seo_plugin: seoPlugin,
      last_verified_at: new Date().toISOString(),
      is_active: true
    }, { onConflict: 'site_id' })

    if (error) {
      return NextResponse.json({ success: false, message: `Could not save the connection: ${error.message}` })
    }

    // First CMS connection → kick off AI Visibility citation check (fire-and-forget).
    void import('@/lib/ai-visibility/run-citation-check')
      .then(({ runCitationCheck }) =>
        runCitationCheck({
          supabase,
          userId: user.id,
          siteId,
          trigger: 'first_connect',
        }),
      )
      .catch((err) => console.warn('[connect-site] first AI visibility run skipped', err))

    let message = check.detail ? `Connected. ${check.detail}` : 'Connected successfully.'
    if (platform === 'wordpress') {
      message += seoPlugin
        ? ` Detected ${seoPlugin} — schema fixes will work alongside it.`
        : ' No SEO plugin detected — fixes will inject schema directly into post content, which is fully valid.'
    }
    message += ' AI Visibility citation check started in the background.'

    return NextResponse.json({ success: true, message })
  } catch (error) {
    console.error('[connect-site]', error)
    return NextResponse.json({ success: false, message: 'Something went wrong connecting this site.' }, { status: 500 })
  }
}
