import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { generateContentBrief, type BriefMode } from '@/lib/content-brief-generator'

/**
 * Content Brief from the user's seed keyword only.
 * No external keyword-volume / SERP expansion — the brief's H1/H2
 * structure, guidance, and "needs real source" flags do not require it.
 */
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
    const seed = typeof body.seedKeyword === 'string' ? body.seedKeyword.trim() : ''
    const market = typeof body.market === 'string' ? body.market : 'Global'
    const mode = (body.mode as BriefMode | undefined) || undefined
    if (!seed) return NextResponse.json({ error: 'seedKeyword is required' }, { status: 400 })

    const brief = await generateContentBrief({
      seedKeyword: seed,
      mode,
      market,
    })

    return NextResponse.json({
      ok: true,
      seedKeyword: seed,
      market,
      brief,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Brief failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
