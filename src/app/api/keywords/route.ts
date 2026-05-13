import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createHash } from 'crypto'

// Per-plan limits. Free = daily; Starter/Pro = monthly; Agency/Master = unlimited.
const PLAN_LIMITS: Record<string, { keywords: number; period: 'day' | 'month' | 'unlimited' }> = {
  free:    { keywords: 5,    period: 'day' },
  starter: { keywords: 500,  period: 'month' },
  pro:     { keywords: 2000, period: 'month' },
  agency:  { keywords: Infinity, period: 'unlimited' },
}

const COUNTRY_LOCATION_CODES: Record<string, number> = {
  Global: 2840, UK: 2826, US: 2840, AU: 2036, CA: 2124,
  DE: 2276,    FR: 2250, IN: 2356, AE: 2784, SA: 2682,
  SG: 2702,    ZA: 2710, PK: 2586,
}

const COUNTRY_LANGUAGE_CODES: Record<string, string> = {
  DE: 'de', FR: 'fr',
}

async function checkAuth(): Promise<{ authed: boolean; isMaster: boolean; userId?: string; userEmail?: string }> {
  const cookieStore = cookies()

  // Master cookie bypass
  const masterToken = cookieStore.get('seoranko_master')?.value
  if (masterToken) {
    const masterEmail = process.env.MASTER_EMAIL
    const masterPassword = process.env.MASTER_PASSWORD
    if (masterEmail && masterPassword) {
      const expected = createHash('sha256')
        .update(`${masterEmail}:${masterPassword}:master`)
        .digest('hex')
      if (masterToken === expected) {
        return { authed: true, isMaster: true, userEmail: masterEmail }
      }
    }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { authed: false, isMaster: false }
  return {
    authed: true,
    isMaster: user.email === process.env.MASTER_EMAIL,
    userId: user.id,
    userEmail: user.email,
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkAuth()

    if (!auth.authed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isMaster = auth.isMaster

    if (!isMaster && auth.userId) {
      const cookieStore = cookies()
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { get(name: string) { return cookieStore.get(name)?.value } } }
      )

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('plan, keywords_used_today, keywords_used_month')
        .eq('id', auth.userId)
        .single()

      const plan = profile?.plan ?? 'free'
      const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

      if (limit.period !== 'unlimited') {
        const used = limit.period === 'day'
          ? (profile?.keywords_used_today ?? 0)
          : (profile?.keywords_used_month ?? 0)

        if (used >= limit.keywords) {
          return NextResponse.json(
            { error: 'Daily limit reached. Upgrade your plan.' },
            { status: 429 }
          )
        }

        await supabase
          .from('user_profiles')
          .update({
            keywords_used_today: (profile?.keywords_used_today ?? 0) + 1,
            keywords_used_month: (profile?.keywords_used_month ?? 0) + 1,
          })
          .eq('id', auth.userId)
      }
    }

    const { keyword, country } = await request.json()
    const locationCode = COUNTRY_LOCATION_CODES[country] ?? 2840
    const languageCode = COUNTRY_LANGUAGE_CODES[country] ?? 'en'
    const dfsAuth = Buffer.from(
      `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
    ).toString('base64')

    const headers = {
      'Authorization': `Basic ${dfsAuth}`,
      'Content-Type': 'application/json',
    }

    // Call 1: seed keyword data + suggestions
    const suggestionsRes = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live',
      {
        method: 'POST',
        headers,
        body: JSON.stringify([{
          keyword,
          location_code: locationCode,
          language_code: languageCode,
          limit: 50,
          include_seed_keyword: true,
        }]),
      }
    )
    const suggestionsData = await suggestionsRes.json()
    console.log('[keywords] suggestions status:', suggestionsRes.status, 'tasks[0].status_message:', suggestionsData?.tasks?.[0]?.status_message)
    console.log('[keywords] suggestions first result sample:', JSON.stringify(suggestionsData?.tasks?.[0]?.result?.[0]?.items?.[0]))
    const suggestions = suggestionsData?.tasks?.[0]?.result?.[0]?.items || []

    // Call 2: related keyword ideas
    const ideasRes = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live',
      {
        method: 'POST',
        headers,
        body: JSON.stringify([{
          keyword,
          location_code: locationCode,
          language_code: languageCode,
          limit: 50,
        }]),
      }
    )
    const ideasData = await ideasRes.json()
    console.log('[keywords] ideas status:', ideasRes.status, 'tasks[0].status_message:', ideasData?.tasks?.[0]?.status_message)
    const ideas = ideasData?.tasks?.[0]?.result?.[0]?.items || []

    console.log(`[keywords] request: keyword="${keyword}" country="${country}" location_code=${locationCode} language_code=${languageCode} suggestions=${suggestions.length} ideas=${ideas.length}`)

    if (suggestions.length === 0 && ideas.length === 0) {
      return NextResponse.json(
        { error: 'No keywords found for this query. Try a different keyword or country.' },
        { status: 500 }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseItem = (item: any) => ({
      keyword: item.keyword,
      volume: item.keyword_info?.search_volume
        || item.keyword_properties?.keyword_info?.search_volume
        || item.search_volume
        || 0,
      kd: item.keyword_properties?.keyword_difficulty
        ?? item.keyword_info?.keyword_difficulty
        ?? item.keyword_difficulty
        ?? 0,
      cpc: item.keyword_info?.cpc
        || item.keyword_properties?.keyword_info?.cpc
        || item.cpc
        || 0,
      intent: item.search_intent_info?.main_intent || 'informational',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trend: item.keyword_info?.monthly_searches?.map((m: any) => m.search_volume) || [],
    })

    const parsedSuggestions = suggestions.map(parseItem)
    const parsedIdeas = ideas.map(parseItem)

    // Merge, deduplicate, sort by volume
    const allKeywords = [...parsedSuggestions, ...parsedIdeas]
    const seen = new Set()
    const unique = allKeywords.filter(item => {
      if (seen.has(item.keyword)) return false
      seen.add(item.keyword)
      return true
    })
    const sorted = unique.sort((a, b) => b.volume - a.volume)

    // Force seed keyword at position 0
    const seedExists = sorted.find(k => k.keyword.toLowerCase() === keyword.toLowerCase())

    if (!seedExists) {
      const seedData = parsedSuggestions[0] || parsedIdeas[0]
      sorted.unshift({
        keyword,
        volume: seedData?.volume || 0,
        kd: seedData?.kd || 0,
        cpc: seedData?.cpc || 0,
        intent: 'informational',
        trend: seedData?.trend || [],
      })
    } else {
      const filtered = sorted.filter(k => k.keyword.toLowerCase() !== keyword.toLowerCase())
      sorted.length = 0
      sorted.push(seedExists, ...filtered)
    }

    return NextResponse.json({ keywords: sorted, master: isMaster })

  } catch (error) {
    console.error('Keywords API error:', error)
    return NextResponse.json({ error: 'Failed to fetch keywords' }, { status: 500 })
  }
}
