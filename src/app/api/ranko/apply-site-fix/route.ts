import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { applySiteAutoFix, SiteFixType } from '@/lib/site-autofix'

export const maxDuration = 120

const VALID_FIX_TYPES: SiteFixType[] = [
  'schema-org-inject',
  'schema-article-inject',
  'author-bio-visible'
]

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

    const { siteId, issueId, fixType, targetUrl } = await req.json()

    if (!siteId || !issueId || !targetUrl) {
      return NextResponse.json(
        { success: false, message: 'siteId, issueId and targetUrl are required.' },
        { status: 400 }
      )
    }

    if (!VALID_FIX_TYPES.includes(fixType)) {
      return NextResponse.json(
        { success: false, message: `Unsupported fix type: ${fixType}` },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Brand details come from the connected site, not the client, so a caller
    // can't inject arbitrary text into the user's live page.
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain, brand')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!site) {
      return NextResponse.json({ success: false, message: 'Site not found.' }, { status: 404 })
    }

    const brandName = site.brand && site.brand !== 'other'
      ? site.brand.charAt(0).toUpperCase() + site.brand.slice(1)
      : site.domain

    const result = await applySiteAutoFix(
      supabase, user.id, siteId, issueId, fixType as SiteFixType,
      targetUrl, brandName, ''
    )

    return NextResponse.json(result)
  } catch (error) {
    console.error('[apply-site-fix]', error)
    return NextResponse.json({ success: false, message: String(error) }, { status: 500 })
  }
}
