import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { verifyConnection, detectSeoPlugin, normaliseSiteUrl } from '@/lib/wordpress-connector'

export const maxDuration = 60

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

    const { siteId, domain, username, appPassword } = await req.json()

    if (!siteId || !domain || !username || !appPassword) {
      return NextResponse.json(
        { success: false, message: 'Site, username and Application Password are all required.' },
        { status: 400 }
      )
    }

    const siteUrl = normaliseSiteUrl(domain)
    if (!siteUrl) {
      return NextResponse.json(
        { success: false, message: 'That domain cannot be connected — only public https sites are supported.' },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // The caller must own this site — siteId comes from the client.
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!site) {
      return NextResponse.json({ success: false, message: 'Site not found.' }, { status: 404 })
    }

    const conn = { siteUrl, username, appPassword }
    const check = await verifyConnection(conn)

    // Never store a credential we haven't proven works.
    if (!check.success) {
      return NextResponse.json({ success: false, message: check.error })
    }

    const seoPlugin = await detectSeoPlugin(conn)

    const { error } = await supabase.from('site_connections').upsert({
      site_id: siteId,
      user_id: user.id,
      cms_type: 'wordpress',
      wp_username: username,
      wp_app_password: appPassword,
      detected_seo_plugin: seoPlugin,
      last_verified_at: new Date().toISOString(),
      is_active: true
    }, { onConflict: 'site_id' })

    if (error) {
      return NextResponse.json({ success: false, message: `Could not save the connection: ${error.message}` })
    }

    return NextResponse.json({
      success: true,
      message: `Connected successfully.${seoPlugin
        ? ` Detected ${seoPlugin} — schema fixes will work alongside it.`
        : ' No SEO plugin detected — fixes will inject schema directly into post content, which is fully valid.'}`
    })
  } catch (error) {
    console.error('[connect-wordpress]', error)
    return NextResponse.json({ success: false, message: 'Something went wrong connecting this site.' }, { status: 500 })
  }
}
