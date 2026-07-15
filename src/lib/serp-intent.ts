/* eslint-disable @typescript-eslint/no-explicit-any */
// Classifies search intent from live SERP results — not ML models
// Gap vs repos: All intent classifiers use trained models on query text.
// SEORANKO checks what Google actually shows in top 10 and classifies from that.

export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'

export interface IntentAnalysis {
  keyword: string
  intent: SearchIntent
  confidence: number
  serpEvidence: string
  canUserArticleRank: boolean
  ceiling: number | null
  recommendation: string
  serpFeatures: string[]
  topResultTypes: string[]
}

async function fetchSERPResults(keyword: string, locationCode: number = 2840): Promise<any[]> {
  const email = process.env.DATAFORSEO_EMAIL
  const password = process.env.DATAFORSEO_PASSWORD
  if (!email || !password) throw new Error('DataForSEO credentials not configured')

  const credentials = Buffer.from(`${email}:${password}`).toString('base64')
  const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      keyword,
      location_code: locationCode,
      language_code: 'en',
      device: 'desktop',
      depth: 10
    }]),
    signal: AbortSignal.timeout(20000)
  })

  const data = await res.json()
  return data?.tasks?.[0]?.result?.[0]?.items || []
}

function classifyResultType(item: any): string {
  const url = (item.url || '').toLowerCase()
  const title = (item.title || '').toLowerCase()
  const domain = (item.domain || '').toLowerCase()

  if (['amazon', 'ebay', 'etsy', 'shopify', 'shop'].some(s => domain.includes(s))) return 'ecommerce'
  if (url.includes('/product') || url.includes('/shop') || url.includes('/buy')) return 'product page'
  if (url.includes('/category') || url.includes('/collection')) return 'category page'
  if (['youtube', 'vimeo', 'tiktok'].some(s => domain.includes(s))) return 'video'
  if (['reddit', 'quora', 'forum'].some(s => domain.includes(s))) return 'forum'
  if (url.includes('/wiki')) return 'wikipedia'
  if (url.includes('/blog') || url.includes('/article') || url.includes('/guide') || url.includes('/how-to')) return 'blog post'
  if (title.includes('best ') || title.includes('top ') || title.includes('review')) return 'review/comparison'
  if (title.includes('how to') || title.includes('what is') || title.includes('guide')) return 'informational'
  return 'other'
}

export async function analyzeSERPIntent(
  keyword: string,
  userContentType: 'informational' | 'product' | 'service' | 'comparison',
  locationCode: number = 2840
): Promise<IntentAnalysis> {

  let serpItems: any[] = []
  try {
    serpItems = await fetchSERPResults(keyword, locationCode)
  } catch {
    const kw = keyword.toLowerCase()
    const isTransactional = /\b(buy|price|cheap|discount|deal|order|purchase|shop)\b/.test(kw)
    const isCommercial = /\b(best|top|review|compare|vs|alternative)\b/.test(kw)
    return {
      keyword,
      intent: isTransactional ? 'transactional' : isCommercial ? 'commercial' : 'informational',
      confidence: 60,
      serpEvidence: 'Based on keyword analysis (SERP data unavailable)',
      canUserArticleRank: !isTransactional,
      ceiling: isTransactional ? 15 : null,
      recommendation: isTransactional
        ? 'This keyword has transactional intent — an informational article will struggle to rank above position 15.'
        : 'Keyword appears informational — your article is well-positioned to rank.',
      serpFeatures: [],
      topResultTypes: []
    }
  }

  const organicItems = serpItems.filter((i: any) => i.type === 'organic').slice(0, 10)
  const resultTypes = organicItems.map(classifyResultType)

  const typeCounts: Record<string, number> = {}
  for (const t of resultTypes) typeCounts[t] = (typeCounts[t] || 0) + 1

  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type)

  const commercialTypes = ['ecommerce', 'product page', 'category page', 'review/comparison']
  const commercialCount = resultTypes.filter(t => commercialTypes.includes(t)).length
  const informationalCount = resultTypes.filter(t => ['blog post', 'informational', 'wikipedia'].includes(t)).length

  let intent: SearchIntent
  let confidence: number

  if (commercialCount >= 7) { intent = 'transactional'; confidence = 90 }
  else if (commercialCount >= 4) { intent = 'commercial'; confidence = 75 }
  else if (informationalCount >= 6) { intent = 'informational'; confidence = 85 }
  else { intent = 'informational'; confidence = 60 }

  const canRank = intent === 'informational'
    ? userContentType === 'informational'
    : intent === 'commercial'
      ? ['comparison', 'informational'].includes(userContentType)
      : userContentType === 'product' || userContentType === 'service'

  const ceiling = canRank ? null : intent === 'transactional' ? 20 : 12

  const serpFeatures = Array.from(new Set(
    serpItems
      .filter((i: any) => i.type !== 'organic')
      .map((i: any) => i.type as string)
  )).slice(0, 5)

  const serpEvidence = `${commercialCount} of top 10 are commercial/product pages, ${informationalCount} are informational`

  const recommendation = !canRank
    ? `Intent mismatch — ${commercialCount} of 10 results are commercial pages. Your ${userContentType} article has a realistic ceiling around position ${ceiling}. Consider creating a ${intent === 'transactional' ? 'product/service page' : 'comparison page'} for this keyword instead.`
    : intent === 'commercial'
      ? 'Commercial intent — add a comparison table, pricing section, or "best X for Y" structure to match what ranks.'
      : 'Informational intent confirmed — your article format matches what Google rewards for this keyword.'

  return {
    keyword,
    intent,
    confidence,
    serpEvidence,
    canUserArticleRank: canRank,
    ceiling,
    recommendation,
    serpFeatures,
    topResultTypes: topTypes
  }
}
