import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { keyword, country } = await request.json()
    const locationCode = country === 'US' ? 2840 : 2826
    const auth = Buffer.from(
      `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
    ).toString('base64')

    const headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    }

    // Call 1: Get seed keyword data + suggestions
    const suggestionsRes = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live',
      {
        method: 'POST',
        headers,
        body: JSON.stringify([{
          keyword: keyword,
          location_code: locationCode,
          language_code: 'en',
          limit: 50,
          include_seed_keyword: true
        }])
      }
    )
    const suggestionsData = await suggestionsRes.json()
    const suggestions = suggestionsData?.tasks?.[0]?.result?.[0]?.items || []

    // Call 2: Get keyword ideas
    const ideasRes = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live',
      {
        method: 'POST',
        headers,
        body: JSON.stringify([{
          keyword: keyword,
          location_code: locationCode,
          language_code: 'en',
          limit: 50
        }])
      }
    )
    const ideasData = await ideasRes.json()
    const ideas = ideasData?.tasks?.[0]?.result?.[0]?.items || []

    // Debug: log field structure from first item of each response
    console.log('Sample suggestion keys:', JSON.stringify(Object.keys(suggestions[0] || {})))
    console.log('Sample suggestion:', JSON.stringify(suggestions[0]))
    console.log('Sample idea keys:', JSON.stringify(Object.keys(ideas[0] || {})))
    console.log('Sample idea:', JSON.stringify(ideas[0]))

    // Parse suggestions (try multiple KD field paths)
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
      trend: item.keyword_info?.monthly_searches?.map((m: any) => m.search_volume) || []
    }))

    // Parse ideas (try multiple KD field paths)
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
      trend: item.keyword_info?.monthly_searches?.map((m: any) => m.search_volume) || []
    }))

    // Merge and deduplicate
    const allKeywords = [...parsedSuggestions, ...parsedIdeas]
    const seen = new Set()
    const unique = allKeywords.filter(item => {
      if (seen.has(item.keyword)) return false
      seen.add(item.keyword)
      return true
    })

    // Sort by volume (seed will be pinned below)
    const sorted = unique.sort((a, b) => b.volume - a.volume)

    // Force seed keyword at position 0
    const seedExists = sorted.find(
      k => k.keyword.toLowerCase() === keyword.toLowerCase()
    )

    if (!seedExists) {
      const seedData = parsedSuggestions[0] || parsedIdeas[0]
      const forcedSeed = {
        keyword: keyword,
        volume: seedData?.volume || 0,
        kd: seedData?.kd || 0,
        cpc: seedData?.cpc || 0,
        intent: 'informational',
        trend: seedData?.trend || []
      }
      sorted.unshift(forcedSeed)
    } else {
      const filtered = sorted.filter(
        k => k.keyword.toLowerCase() !== keyword.toLowerCase()
      )
      sorted.length = 0
      sorted.push(seedExists, ...filtered)
    }

    return NextResponse.json({ keywords: sorted })

  } catch (error) {
    console.error('Keywords API error:', error)
    return NextResponse.json({ error: 'Failed to fetch keywords' }, { status: 500 })
  }
}
