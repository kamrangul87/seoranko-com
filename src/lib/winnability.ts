// src/lib/winnability.ts
// RANKO's first expert judgment: is this keyword winnable?
// Called BEFORE any article work begins — and displayed as a gate.
//
// Logic: fetch live top-10 SERP via DataForSEO → classify result types →
// determine whether a content article can realistically reach page 1 →
// return a verdict with specific reasoning.
/* eslint-disable @typescript-eslint/no-explicit-any */

import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient } from '@/lib/anthropic'

export type WinnabilityVerdict =
  | 'highly-winnable'    // Top 10 dominated by informational content, low-DR sites
  | 'winnable'           // Mixed results, content sites present, opportunity exists
  | 'contested'          // Strong incumbents but gaps visible
  | 'unwinnable'         // Product pages / video / big brands dominate — don't waste effort
  | 'redirect'           // Better to target a related keyword instead

export interface WinnabilityResult {
  keyword: string
  verdict: WinnabilityVerdict
  score: number             // 0-100 (100 = most winnable)
  confidence: number        // 0-100 (how confident RANKO is)
  reasoning: string         // plain English explanation — 2-3 sentences
  serpComposition: {
    informationalCount: number
    productPageCount: number
    videoCount: number
    bigBrandCount: number
    lowDRCount: number       // estimated sites that are beatable
  }
  intentMatch: boolean      // does a content article match what Google shows?
  recommendedAction: string // specific next step
  alternativeKeyword?: string // if redirect verdict, suggest a better target
  checkedAt: string
}

async function fetchSERPData(keyword: string, locationCode: number = 2840) {
  const email = process.env.DATAFORSEO_EMAIL
  const password = process.env.DATAFORSEO_PASSWORD
  if (!email || !password) throw new Error('DataForSEO credentials not configured')

  const creds = Buffer.from(`${email}:${password}`).toString('base64')
  const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      keyword,
      location_code: locationCode,
      language_code: 'en',
      device: 'desktop',
      depth: 10
    }]),
    signal: AbortSignal.timeout(25000)
  })

  if (!res.ok) throw new Error(`DataForSEO SERP error: ${res.status}`)
  const data = await res.json()
  return data?.tasks?.[0]?.result?.[0]?.items || []
}

function classifyResultType(item: any): string {
  const url = (item.url || '').toLowerCase()
  const domain = (item.domain || '').toLowerCase()
  const title = (item.title || '').toLowerCase()

  // Big brands — hard to beat
  const bigBrands = ['amazon', 'ebay', 'wikipedia', 'youtube', 'reddit', 'bbc', 'guardian',
    'nhs.uk', 'gov.uk', 'forbes', 'healthline', 'webmd', 'nytimes', 'theguardian']
  if (bigBrands.some(b => domain.includes(b))) return 'big-brand'

  if (['youtube', 'vimeo', 'tiktok'].some(s => domain.includes(s))) return 'video'
  if (item.type !== 'organic') return 'non-organic'
  if (url.includes('/product') || url.includes('/shop') || url.includes('/buy') ||
    ['amazon', 'ebay', 'etsy'].some(s => domain.includes(s))) return 'product'
  if (url.includes('/category') || url.includes('/collection')) return 'category'
  if (title.includes('best ') || title.includes('top ') || title.includes('review')) return 'listicle'
  if (url.includes('/blog') || url.includes('/article') || url.includes('/guide') ||
    title.includes('how to') || title.includes('what is') || title.includes('guide')) return 'informational'
  return 'other'
}

const client = getAnthropicClient()

export async function scoreWinnability(
  keyword: string,
  locationCode: number = 2840,
  userContentType: 'informational' | 'product' | 'service' = 'informational'
): Promise<WinnabilityResult> {

  let serpItems: any[] = []
  try {
    serpItems = await fetchSERPData(keyword, locationCode)
  } catch {
    // Fallback: keyword-only classification
    const kw = keyword.toLowerCase()
    const isCommercial = /\b(buy|price|cheap|best|review|vs|compare|top \d+)\b/.test(kw)
    return {
      keyword,
      verdict: isCommercial ? 'contested' : 'winnable',
      score: isCommercial ? 45 : 65,
      confidence: 40,
      reasoning: 'SERP data unavailable — scored from keyword signals only. Run again for full analysis.',
      serpComposition: { informationalCount: 0, productPageCount: 0, videoCount: 0, bigBrandCount: 0, lowDRCount: 0 },
      intentMatch: !isCommercial,
      recommendedAction: isCommercial ? 'Verify SERP composition before investing in this keyword.' : 'Proceed with content creation.',
      checkedAt: new Date().toISOString()
    }
  }

  const organicItems = serpItems.filter((i: any) => i.type === 'organic').slice(0, 10)
  const resultTypes = organicItems.map(classifyResultType)

  const serpComposition = {
    informationalCount: resultTypes.filter(t => ['informational', 'listicle', 'other'].includes(t)).length,
    productPageCount: resultTypes.filter(t => ['product', 'category'].includes(t)).length,
    videoCount: resultTypes.filter(t => t === 'video').length,
    bigBrandCount: resultTypes.filter(t => t === 'big-brand').length,
    lowDRCount: Math.max(0, organicItems.length - resultTypes.filter(t =>
      ['big-brand', 'video'].includes(t)
    ).length)
  }

  const intentMatch = serpComposition.informationalCount >= 4 ||
    (serpComposition.informationalCount >= 2 && serpComposition.productPageCount <= 3)

  // Use Claude Haiku for fast scoring judgment
  const serpSummary = resultTypes.slice(0, 10).map((t, i) =>
    `${i + 1}. ${t} (${organicItems[i]?.domain || 'unknown'})`
  ).join('\n')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `As an expert SEO strategist with 25 years experience, assess whether a ${userContentType} article can realistically reach Google page 1 for: "${keyword}"

Current top-10 SERP composition:
${serpSummary}

Informational content: ${serpComposition.informationalCount}/10
Product/commercial pages: ${serpComposition.productPageCount}/10
Videos: ${serpComposition.videoCount}/10
Big brand domains: ${serpComposition.bigBrandCount}/10

Verdict must be one of: highly-winnable / winnable / contested / unwinnable / redirect

Respond JSON only:
{
  "verdict": "winnable",
  "score": 72,
  "confidence": 85,
  "reasoning": "2-3 sentence plain English explanation of why this is or isn't winnable",
  "recommendedAction": "specific next step in one sentence",
  "alternativeKeyword": "only if redirect verdict, suggest a better keyword"
}`
    }]
  })

  let verdictData: any = {
    verdict: 'winnable',
    score: 60,
    confidence: 70,
    reasoning: 'SERP shows mixed results.',
    recommendedAction: 'Proceed with content creation.',
  }

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    verdictData = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch { /* use defaults */ }

  return {
    keyword,
    verdict: verdictData.verdict || 'winnable',
    score: Math.min(100, Math.max(0, verdictData.score || 60)),
    confidence: Math.min(100, Math.max(0, verdictData.confidence || 70)),
    reasoning: verdictData.reasoning || 'Analysis complete.',
    serpComposition,
    intentMatch,
    recommendedAction: verdictData.recommendedAction || 'Proceed with content creation.',
    alternativeKeyword: verdictData.alternativeKeyword,
    checkedAt: new Date().toISOString()
  }
}
