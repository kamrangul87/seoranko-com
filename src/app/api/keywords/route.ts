import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Per-plan limits. Free = daily; Starter/Pro = monthly; Agency/Master = unlimited.
const PLAN_LIMITS: Record<string, { keywords: number; period: 'day' | 'month' | 'unlimited' }> = {
  free:    { keywords: 5,    period: 'day' },
  starter: { keywords: 500,  period: 'month' },
  pro:     { keywords: 2000, period: 'month' },
  agency:  { keywords: Infinity, period: 'unlimited' },
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isMaster = user.email === process.env.MASTER_EMAIL

    if (!isMaster) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('plan, keywords_used_today, keywords_used_month')
        .eq('id', user.id)
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
          .eq('id', user.id)
      }
    }

    const { keyword, country } = await request.json()
    const locationCode = country === 'US' ? 2840 : 2826
    const auth = Buffer.from(
      `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
    ).toString('base64')

    const headers = {
      'Authorization': `Basic ${auth}`,
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
          language_code: 'en',
          limit: 50,
          include_seed_keyword: true,
        }]),
      }
    )
    const suggestionsData = await suggestionsRes.json()
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
          language_code: 'en',
          limit: 50,
        }]),
      }
    )
    const ideasData = await ideasRes.json()
    const ideas = ideasData?.tasks?.[0]?.result?.[0]?.items || []

    console.log('Sample suggestion keys:', JSON.stringify(Object.keys(suggestions[0] || {})))
    console.log('Sample suggestion:', JSON.stringify(suggestions[0]))
    console.log('Sample idea keys:', JSON.stringify(Object.keys(ideas[0] || {})))
    console.log('Sample idea:', JSON.stringify(ideas[0]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedSuggestions = suggestions.map((item: any) => ({
      keyword: item.keyword,
      volume: item.keyword_info?.search_volume || 0,
      kd: item.keyword_properties?.keyword_difficulty
        ?? item.keyword_info?.keyword_difficulty
        ?? item.keyword_difficulty
        ?? 0,
      cpc: item.keyword_info?.cpc || 0,
      intent: item.search_intent_info?.main_intent || 'informational',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trend: item.keyword_info?.monthly_searches?.map((m: any) => m.search_volume) || [],
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedIdeas = ideas.map((item: any) => ({
      keyword: item.keyword,
      volume: item.keyword_info?.search_volume || 0,
      kd: item.keyword_properties?.keyword_difficulty
        ?? item.keyword_info?.keyword_difficulty
        ?? item.keyword_difficulty
        ?? 0,
      cpc: item.keyword_info?.cpc || 0,
      intent: item.search_intent_info?.main_intent || 'informational',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trend: item.keyword_info?.monthly_searches?.map((m: any) => m.search_volume) || [],
    }))

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
