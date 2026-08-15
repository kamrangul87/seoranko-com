import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { callClaude } from '@/lib/anthropic'
import { checkCitationOpportunity } from '@/lib/citation-tester'
import { getCachedEntityPresence } from '@/lib/entity-checker'
import { MODEL_FOR } from '@/lib/model-router'
import { locationCodeFor, languageCodeFor } from '@/lib/markets'

// Per-plan limits. Free = daily; Starter/Pro = monthly; Agency/Master = unlimited.
const PLAN_LIMITS: Record<string, { keywords: number; period: 'day' | 'month' | 'unlimited' }> = {
  free:    { keywords: 5,    period: 'day' },
  starter: { keywords: 500,  period: 'month' },
  pro:     { keywords: 2000, period: 'month' },
  agency:  { keywords: Infinity, period: 'unlimited' },
}

async function checkAuth(): Promise<{ authed: boolean; isMaster: boolean; userId?: string; userEmail?: string }> {
  const cookieStore = cookies()

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
    const locationCode = locationCodeFor(country)
    const languageCode = languageCodeFor(country)
    const dfsAuth = Buffer.from(
      `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
    ).toString('base64')

    const headers = {
      'Authorization': `Basic ${dfsAuth}`,
      'Content-Type': 'application/json',
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dfsSearch = async (kw: string): Promise<{ suggestions: any[]; ideas: any[] }> => {
      const [suggestionsRes, ideasRes] = await Promise.all([
        fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live', {
          method: 'POST', headers,
          body: JSON.stringify([{ keyword: kw, location_code: locationCode, language_code: languageCode, limit: 100, include_seed_keyword: true }]),
        }),
        fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live', {
          method: 'POST', headers,
          body: JSON.stringify([{ keyword: kw, location_code: locationCode, language_code: languageCode, limit: 100 }]),
        }),
      ])
      const [suggestionsData, ideasData] = await Promise.all([suggestionsRes.json(), ideasRes.json()])
      console.log(`[keywords] dfsSearch "${kw}" — suggestions: ${suggestionsData?.tasks?.[0]?.result?.[0]?.items?.length ?? 0}, ideas: ${ideasData?.tasks?.[0]?.result?.[0]?.items?.length ?? 0}`)
      return {
        suggestions: suggestionsData?.tasks?.[0]?.result?.[0]?.items || [],
        ideas:       ideasData?.tasks?.[0]?.result?.[0]?.items || [],
      }
    }

    // Primary search
    let { suggestions, ideas } = await dfsSearch(keyword)
    let usedKeyword = keyword
    let broaderKeyword: string | null = null

    // Fallback: if too few results, try progressively broader keywords
    if (suggestions.length + ideas.length < 10) {
      // Try removing last word first
      const shortened = keyword.split(' ').slice(0, -1).join(' ')
      if (shortened && shortened !== keyword) {
        console.log(`[keywords] too few results (${suggestions.length + ideas.length}), trying shortened: "${shortened}"`)
        const shorter = await dfsSearch(shortened)
        if (shorter.suggestions.length + shorter.ideas.length > suggestions.length + ideas.length) {
          suggestions = shorter.suggestions
          ideas = shorter.ideas
          usedKeyword = shortened
        }
      }

      // Still too few — ask Claude for a broader alternative
      if (suggestions.length + ideas.length < 10) {
        try {
          const broaderRaw = await callClaude(
            'You are an SEO keyword expert. Return ONLY a 1-2 word broad keyword with high monthly search volume. No punctuation, no explanation.',
            `The keyword "${keyword}" returned very few search results. Suggest a BROADER 1-2 word version with much higher search volume. Return ONLY the keyword.`,
            100,
            MODEL_FOR.keywordClassification
          )
          const broader = broaderRaw.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
          if (broader && broader !== keyword && broader !== usedKeyword) {
            console.log(`[keywords] still few results, trying Claude broader: "${broader}"`)
            const broaderRes = await dfsSearch(broader)
            if (broaderRes.suggestions.length + broaderRes.ideas.length > suggestions.length + ideas.length) {
              suggestions = [...suggestions, ...broaderRes.suggestions]
              ideas = [...ideas, ...broaderRes.ideas]
              broaderKeyword = broader
              usedKeyword = broader
            }
          }
        } catch (e) {
          console.error('[keywords] broader keyword fallback error:', e)
        }
      }
    }

    console.log(`[keywords] final: usedKeyword="${usedKeyword}" suggestions=${suggestions.length} ideas=${ideas.length}`)

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
        || item.monthly_searches?.[0]?.search_volume
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

    // If seed keyword still has volume 0, fetch from keyword_overview as fallback
    if (sorted[0] && sorted[0].volume === 0) {
      try {
        const overviewRes = await fetch(
          'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live',
          {
            method: 'POST',
            headers,
            body: JSON.stringify([{
              keywords: [keyword],
              location_code: locationCode,
              language_code: languageCode,
            }]),
          }
        )
        const overviewData = await overviewRes.json()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const overviewItem = overviewData?.tasks?.[0]?.result?.[0]?.items?.find((i: any) =>
          i.keyword?.toLowerCase() === keyword.toLowerCase()
        )
        if (overviewItem) {
          const overviewVolume = overviewItem.keyword_info?.search_volume
            || overviewItem.keyword_properties?.keyword_info?.search_volume
            || overviewItem.monthly_searches?.[0]?.search_volume
            || overviewItem.search_volume
            || 0
          console.log(`[keywords] overview fallback for seed "${keyword}": volume=${overviewVolume}`)
          sorted[0].volume = overviewVolume
          sorted[0].kd = overviewItem.keyword_properties?.keyword_difficulty
            ?? overviewItem.keyword_info?.keyword_difficulty
            ?? sorted[0].kd
          sorted[0].cpc = overviewItem.keyword_info?.cpc
            || overviewItem.keyword_properties?.keyword_info?.cpc
            || sorted[0].cpc
        }
      } catch (overviewErr) {
        console.error('[keywords] overview fallback error:', overviewErr)
      }
    }

    // Check AI citation landscape for top 3 keywords (5s timeout — best-effort)
    const top3 = sorted.slice(0, 3).map(k => k.keyword);
    const citationMap: Record<string, { opportunityScore: number; dominantCompetitors: string[] }> = {};
    try {
      const checks = await Promise.allSettled(
        top3.map(kw => Promise.race([
          checkCitationOpportunity(kw),
          new Promise<null>(res => setTimeout(() => res(null), 5000)),
        ]))
      );
      checks.forEach((result, i) => {
        const kw = top3[i];
        if (result.status === 'fulfilled' && result.value) {
          const v = result.value;
          if (v && typeof v === 'object' && 'opportunityScore' in v) {
            citationMap[kw] = { opportunityScore: v.opportunityScore, dominantCompetitors: v.dominantCompetitors };
          }
        }
      });
    } catch { /* non-fatal */ }

    const keywordsWithCitation = sorted.map(k => ({
      ...k,
      ...(citationMap[k.keyword]
        ? { aiCitationOpportunity: citationMap[k.keyword] }
        : {}),
    }));

    // Cache-only entity lookup for the seed keyword (no extra API cost)
    const entityPresence = await getCachedEntityPresence(keyword).catch(() => null);

    return NextResponse.json({
      keywords: keywordsWithCitation,
      master: isMaster,
      entityPresence,
      ...(broaderKeyword ? { broaderKeyword, usedKeyword } : {}),
    })

  } catch (error) {
    console.error('Keywords API error:', error)
    return NextResponse.json({ error: 'Failed to fetch keywords' }, { status: 500 })
  }
}
