import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { generateContentBrief, type BriefMode } from '@/lib/content-brief-generator'
import { fetchKeywords } from '@/lib/dataforseo'
import { clusterKeywords } from '@/lib/keyword-cluster'
import { findLongTailVariants } from '@/lib/longtail-expander'

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

    // Keyword research cluster (DataForSEO when configured; graceful empty otherwise)
    let ideas: Array<{ keyword: string; searchVolume?: number; competition?: number }> = []
    try {
      const raw = await fetchKeywords(seed, market)
      ideas = (raw || []).slice(0, 40).map((k) => ({
        keyword: k.keyword || '',
        searchVolume: k.volume,
        competition: k.kd,
      })).filter((k) => k.keyword)
    } catch {
      ideas = []
    }

    let longTail: Array<{ keyword: string }> = []
    try {
      longTail = (await findLongTailVariants(seed, market)).slice(0, 15)
    } catch {
      longTail = []
    }

    const clusterInputs = [
      { keyword: seed, volume: 0 },
      ...ideas.slice(0, 12).map((i) => ({ keyword: i.keyword, volume: i.searchVolume || 0 })),
    ]
    let clustered = { primaryKeyword: seed, secondaryKeywords: [] as string[], intent: 'informational' as string | null }
    try {
      if (clusterInputs.length >= 2) {
        clustered = await clusterKeywords(clusterInputs)
      }
    } catch {
      /* keep seed-only cluster */
    }

    const brief = await generateContentBrief({
      seedKeyword: clustered.primaryKeyword || seed,
      mode,
      secondaryKeywords: clustered.secondaryKeywords,
      market,
    })

    // Intent clustering buckets for the UI
    const shortTail = ideas.filter((i) => i.keyword.split(/\s+/).length <= 2).slice(0, 12)
    const longTailList = [
      ...longTail.map((l) => l.keyword),
      ...ideas.filter((i) => i.keyword.split(/\s+/).length >= 3).map((i) => i.keyword),
    ].slice(0, 20)

    return NextResponse.json({
      ok: true,
      seedKeyword: seed,
      market,
      clusters: {
        primary: clustered.primaryKeyword,
        secondary: clustered.secondaryKeywords,
        intent: clustered.intent,
        shortTail,
        longTail: longTailList,
      },
      brief,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Brief failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
