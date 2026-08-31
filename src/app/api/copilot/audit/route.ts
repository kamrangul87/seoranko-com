import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runPageAudit } from '@/lib/page-audit-engine'

/** PSI Core Web Vitals can take 15–45s; keep headroom for crawl + ecommerce checks. */
export const maxDuration = 120

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
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

    const result = await runPageAudit(url)
    return NextResponse.json({ ok: true, audit: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Audit failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
