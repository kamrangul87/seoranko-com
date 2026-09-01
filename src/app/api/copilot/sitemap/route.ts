import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeDomain } from '@/lib/supabase/audit-db'
import { loadOrRunCrawlForSitemap } from '@/lib/sitemap-generator/load-crawl'
import { generateSitemap } from '@/lib/sitemap-generator/generate'
import { persistIndexDiagnosisRun } from '@/lib/index-diagnosis/persist'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const domainOrUrl = typeof body.domain === 'string' ? body.domain.trim() : typeof body.url === 'string' ? body.url.trim() : ''
    if (!domainOrUrl) return NextResponse.json({ error: 'domain or url is required' }, { status: 400 })

    const forceFresh = body.forceFresh === true

    let cmsType: string | null = null
    const domain = normalizeDomain(domainOrUrl)
    const { data: connectedSite } = await supabase
      .from('connected_sites')
      .select('id')
      .eq('user_id', user.id)
      .ilike('domain', domain)
      .maybeSingle()
    if (connectedSite?.id) {
      const { data: conn } = await supabase
        .from('site_connections')
        .select('cms_type')
        .eq('site_id', connectedSite.id)
        .eq('is_active', true)
        .maybeSingle()
      if (conn?.cms_type) cmsType = conn.cms_type
    }

    const crawl = await loadOrRunCrawlForSitemap({
      domainOrUrl,
      userId: user.id,
      forceFresh,
    })

    if (crawl.crawlSource === 'fresh' && crawl.fullResult) {
      void persistIndexDiagnosisRun(user.id, crawl.fullResult)
    }

    const result = generateSitemap(crawl, { cmsType })

    return NextResponse.json({ ok: true, sitemap: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sitemap generation failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
