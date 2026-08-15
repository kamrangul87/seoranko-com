// src/lib/citation-tracker.ts
// Queries real AI engines to check if an article/domain is being cited
// Uses Perplexity API (sonar model) — add PERPLEXITY_API_KEY to .env

export interface CitationCheckResult {
  keyword: string
  articleUrl: string
  checkedAt: string
  engines: {
    perplexity: EngineCitationResult
  }
  isCited: boolean
  citedCompetitors: string[]
  shareOfVoice: number   // 0–100: % of responses where your domain appears
  recommendation: string
}

export interface EngineCitationResult {
  cited: boolean
  mentionedDomain: boolean
  citedUrls: string[]
  competitorUrls: string[]
  responseSnippet: string
  error?: string
}

function buildQueryVariants(keyword: string, locationCode = 2840): string[] {
  const year = new Date().getFullYear()
  const region = locationNameFromCode(locationCode)
  const variants = [
    keyword,
    `what is the best ${keyword}`,
  ]
  if (region && region !== 'Global' && region !== 'United States') {
    variants.push(`${keyword} ${region} ${year}`)
    variants.push(`${keyword} guide ${region}`)
  } else {
    variants.push(`${keyword} guide ${year}`)
  }
  return variants
}

import { LOCATION_OPTIONS } from '@/lib/rank-tracker'
import { citationRecommendation } from '@/lib/competitor-privacy'

function locationNameFromCode(code: number): string {
  const found = LOCATION_OPTIONS.find(l => l.value === code)
  if (!found) return 'Global'
  return found.label.replace(/^[^\s]+\s+/, '')
}

export interface CitationCheckOptions {
  locationCode?: number
}


function extractDomains(urls: string[]): string[] {
  return urls.map(url => {
    try { return new URL(url).hostname.replace('www.', '') }
    catch { return url }
  }).filter(Boolean)
}

async function queryPerplexity(
  query: string,
  targetDomain: string
): Promise<EngineCitationResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) {
    return { cited: false, mentionedDomain: false, citedUrls: [], competitorUrls: [], responseSnippet: '', error: 'PERPLEXITY_API_KEY not configured' }
  }

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: query }],
        return_citations: true,
        return_images: false,
        max_tokens: 500
      }),
      signal: AbortSignal.timeout(30000)
    })

    if (!res.ok) throw new Error(`Perplexity API error: ${res.status}`)
    const data = await res.json()

    const content = data.choices?.[0]?.message?.content || ''
    const citations: string[] = data.citations || []
    const citedDomains = extractDomains(citations)

    const cleanTarget = targetDomain.replace('www.', '').replace(/^https?:\/\//, '')
    const isCited = citedDomains.some(d => d.includes(cleanTarget))
    const competitorUrls = citations.filter((u: string) => !u.includes(cleanTarget))

    return {
      cited: isCited,
      mentionedDomain: content.toLowerCase().includes(cleanTarget.split('.')[0]),
      citedUrls: citations.filter((u: string) => u.includes(cleanTarget)),
      competitorUrls: competitorUrls.slice(0, 5),
      responseSnippet: content.slice(0, 300)
    }
  } catch (err) {
    return { cited: false, mentionedDomain: false, citedUrls: [], competitorUrls: [], responseSnippet: '', error: String(err) }
  }
}

export async function checkArticleCitation(
  keyword: string,
  articleUrl: string,
  options: CitationCheckOptions = {}
): Promise<CitationCheckResult> {
  const domain = new URL(articleUrl.startsWith('http') ? articleUrl : `https://${articleUrl}`).hostname
  const queries = buildQueryVariants(keyword, options.locationCode ?? 2840)

  const results = await Promise.all(
    queries.map(q => queryPerplexity(q, domain))
  )

  const citedCount = results.filter(r => r.cited).length
  const shareOfVoice = Math.round((citedCount / results.length) * 100)
  const isCited = citedCount > 0

  const allCompetitorDomains = Array.from(new Set(
    results.flatMap(r => extractDomains(r.competitorUrls))
  )).filter(d => !d.includes(domain.replace('www.', '')))

  const recommendation = citationRecommendation(shareOfVoice, isCited, allCompetitorDomains.length)

  return {
    keyword,
    articleUrl,
    checkedAt: new Date().toISOString(),
    engines: { perplexity: results[0] },
    isCited,
    citedCompetitors: allCompetitorDomains.slice(0, 5),
    shareOfVoice,
    recommendation
  }
}
