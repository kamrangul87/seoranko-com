/* eslint-disable @typescript-eslint/no-explicit-any */
// Fetches #1 competitor article, extracts their structure, finds gaps, auto-fills them
// Gap vs HasData/python-for-seo N-gram analysis: SEORANKO closes the gap automatically

import Anthropic from '@anthropic-ai/sdk'

export interface CompetitorGapResult {
  keyword: string
  competitorUrl: string
  competitorTitle: string
  userWordCount: number
  competitorWordCount: number
  missingH2s: string[]
  missingFAQs: string[]
  missingEntities: string[]
  missingSchemaTypes: string[]
  coverageScore: number
  autoFillContent: string
}

const client = new Anthropic()

async function fetchArticleContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEORANKO-Gap-Analyser/1.0' },
      signal: AbortSignal.timeout(15000)
    })
    const html = await res.text()
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000)
  } catch {
    return ''
  }
}

function extractH2s(html: string): string[] {
  const matches = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []
  return matches.map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
}

function extractEntities(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) || []
  const counts: Record<string, number> = {}
  for (const m of matches) counts[m] = (counts[m] || 0) + 1
  return Object.entries(counts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([entity]) => entity)
}

export async function analyzeCompetitorGap(
  keyword: string,
  competitorUrl: string,
  userArticleContent: string
): Promise<CompetitorGapResult> {

  const competitorContent = await fetchArticleContent(competitorUrl)

  if (!competitorContent) {
    return {
      keyword,
      competitorUrl,
      competitorTitle: 'Could not fetch competitor article',
      userWordCount: userArticleContent.split(' ').length,
      competitorWordCount: 0,
      missingH2s: [],
      missingFAQs: [],
      missingEntities: [],
      missingSchemaTypes: [],
      coverageScore: 50,
      autoFillContent: ''
    }
  }

  const competitorH2s = extractH2s(competitorContent)
  const userH2s = extractH2s(userArticleContent)
  const competitorEntities = extractEntities(competitorContent)
  const userEntities = extractEntities(userArticleContent)

  const userH2sLower = userH2s.map(h => h.toLowerCase())
  const missingH2s = competitorH2s.filter(h =>
    !userH2sLower.some(u => u.includes(h.toLowerCase().slice(0, 20)))
  )

  const userEntitiesLower = userEntities.map(e => e.toLowerCase())
  const missingEntities = competitorEntities.filter(e =>
    !userEntitiesLower.includes(e.toLowerCase())
  ).slice(0, 10)

  const gapResponse = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are comparing two articles about "${keyword}".

USER ARTICLE (first 2000 chars):
${userArticleContent.slice(0, 2000)}

COMPETITOR ARTICLE (first 2000 chars):
${competitorContent.slice(0, 2000)}

Missing headings the competitor covers but user doesn't:
${missingH2s.slice(0, 5).join('\n') || 'None detected'}

Missing entities:
${missingEntities.slice(0, 5).join(', ') || 'None'}

1. List 3 FAQ questions the competitor addresses that the user doesn't
2. Write a 200-word section filling the most important content gap
3. Rate coverage 0-100 (how well user covers what competitor covers)

Respond JSON only:
{
  "missingFAQs": ["question 1", "question 2", "question 3"],
  "autoFillContent": "200 word section filling the biggest gap",
  "coverageScore": 72
}`
    }]
  })

  let missingFAQs: string[] = []
  let autoFillContent = ''
  let coverageScore = 70

  try {
    const text = gapResponse.content[0].type === 'text' ? gapResponse.content[0].text : '{}'
    const data = JSON.parse(text.replace(/```json|```/g, '').trim())
    missingFAQs = data.missingFAQs || []
    autoFillContent = data.autoFillContent || ''
    coverageScore = data.coverageScore || 70
  } catch { /* use defaults */ }

  const titleMatch = competitorContent.match(/<title[^>]*>(.*?)<\/title>/i)
  const competitorTitle = titleMatch ? titleMatch[1].trim() : competitorUrl

  return {
    keyword,
    competitorUrl,
    competitorTitle,
    userWordCount: userArticleContent.split(/\s+/).length,
    competitorWordCount: competitorContent.split(/\s+/).length,
    missingH2s: missingH2s.slice(0, 5),
    missingFAQs,
    missingEntities: missingEntities.slice(0, 8),
    missingSchemaTypes: [],
    coverageScore,
    autoFillContent
  }
}
