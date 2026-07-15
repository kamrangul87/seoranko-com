/* eslint-disable @typescript-eslint/no-explicit-any */
// Detects keyword cannibalisation and generates automated fix plans
// Gap vs repos: allanreda + jmelm93 detect only. SEORANKO detects AND fixes.

import Anthropic from '@anthropic-ai/sdk'

export interface CannibalPair {
  article1Id: string
  article1Title: string
  article1Keyword: string
  article2Id: string
  article2Title: string
  article2Keyword: string
  overlapScore: number
  sharedTerms: string[]
  recommendation: 'merge' | 'differentiate' | 'monitor'
  fixPlan: string
  severity: 'high' | 'medium' | 'low'
}

export interface CannibalResult {
  pairs: CannibalPair[]
  totalConflicts: number
  highSeverity: number
  topAction: string
  checkedAt: string
}

function jaccardSimilarity(kw1: string, kw2: string): number {
  const tokenise = (s: string) => new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'that', 'this', 'how', 'what', 'why'].includes(w))
  )

  const set1 = tokenise(kw1)
  const set2 = tokenise(kw2)
  const intersection = new Set(Array.from(set1).filter(x => set2.has(x)))
  const union = new Set([...Array.from(set1), ...Array.from(set2)])

  return union.size === 0 ? 0 : (intersection.size / union.size) * 100
}

function getSharedTerms(kw1: string, kw2: string): string[] {
  const tokenise = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
  )
  const set1 = tokenise(kw1)
  const set2 = tokenise(kw2)
  return Array.from(set1).filter(x => set2.has(x))
}

const client = new Anthropic()

export async function detectCannibalization(
  articles: Array<{ id: string; title: string; keyword: string; content?: string }>
): Promise<CannibalResult> {

  const pairs: CannibalPair[] = []

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const a1 = articles[i]
      const a2 = articles[j]

      const kwOverlap = jaccardSimilarity(a1.keyword, a2.keyword)
      const titleOverlap = jaccardSimilarity(a1.title, a2.title)
      const overlapScore = Math.max(kwOverlap, titleOverlap * 0.8)

      if (overlapScore < 40) continue

      const sharedTerms = getSharedTerms(a1.keyword + ' ' + a1.title, a2.keyword + ' ' + a2.title)

      const fixResponse = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Two articles may be cannibalising each other:

Article 1: "${a1.title}" (keyword: "${a1.keyword}")
Article 2: "${a2.title}" (keyword: "${a2.keyword}")
Overlap score: ${Math.round(overlapScore)}%
Shared terms: ${sharedTerms.join(', ')}

Should these be MERGED (one redirects to the other), DIFFERENTIATED (rewrite one to target a distinctly different sub-intent), or just MONITORED?

Respond JSON only:
{
  "recommendation": "merge|differentiate|monitor",
  "fixPlan": "specific one-sentence action to take",
  "severity": "high|medium|low"
}`
        }]
      })

      let recommendation: 'merge' | 'differentiate' | 'monitor' = 'monitor'
      let fixPlan = 'Monitor these two articles — they share some terms but may target different intents.'
      let severity: 'high' | 'medium' | 'low' = overlapScore > 70 ? 'high' : overlapScore > 55 ? 'medium' : 'low'

      try {
        const text = fixResponse.content[0].type === 'text' ? fixResponse.content[0].text : '{}'
        const data = JSON.parse(text.replace(/```json|```/g, '').trim())
        recommendation = data.recommendation || recommendation
        fixPlan = data.fixPlan || fixPlan
        severity = data.severity || severity
      } catch { /* use defaults */ }

      pairs.push({
        article1Id: a1.id,
        article1Title: a1.title,
        article1Keyword: a1.keyword,
        article2Id: a2.id,
        article2Title: a2.title,
        article2Keyword: a2.keyword,
        overlapScore: Math.round(overlapScore),
        sharedTerms,
        recommendation,
        fixPlan,
        severity
      })
    }
  }

  const sorted = pairs.sort((a, b) => b.overlapScore - a.overlapScore)
  const highSeverity = sorted.filter(p => p.severity === 'high').length

  const topAction = sorted.length === 0
    ? 'No cannibalisation detected — your content targets distinct keywords.'
    : sorted[0].recommendation === 'merge'
      ? `Merge "${sorted[0].article1Title}" and "${sorted[0].article2Title}" — they target the same intent and are splitting your authority signal.`
      : `Differentiate "${sorted[0].article1Title}" from "${sorted[0].article2Title}" — rewrite one to target a distinct sub-intent.`

  return {
    pairs: sorted,
    totalConflicts: sorted.length,
    highSeverity,
    topAction,
    checkedAt: new Date().toISOString()
  }
}

export async function executeMergeFix(
  keepArticleId: string,
  mergeArticleId: string
): Promise<{ redirectSql: string; schemaUpdate: string }> {
  return {
    redirectSql: `-- Add this redirect in your CMS or Next.js next.config.mjs:
-- { source: '/blog/[merged-slug]', destination: '/blog/[keep-slug]', permanent: true }`,
    schemaUpdate: `-- Update the merged article's schema to point canonical to the keeper:
UPDATE articles SET canonical_url = (SELECT url FROM articles WHERE id = '${keepArticleId}')
WHERE id = '${mergeArticleId}';`
  }
}
