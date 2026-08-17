/* eslint-disable @typescript-eslint/no-explicit-any */
// Detects keyword cannibalisation and generates automated fix plans.
// Mechanical first (Jaccard + rules), then one batched Haiku call for the
// top pairs — never O(n²) sequential LLM (that timed out on Hobby / Vercel).

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'

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

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'how', 'what', 'why'])

function tokenise(s: string): Set<string> {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w))
  )
}

export function jaccardSimilarity(kw1: string, kw2: string): number {
  const set1 = tokenise(kw1)
  const set2 = tokenise(kw2)
  const intersection = new Set(Array.from(set1).filter(x => set2.has(x)))
  const union = new Set([...Array.from(set1), ...Array.from(set2)])
  return union.size === 0 ? 0 : (intersection.size / union.size) * 100
}

export function getSharedTerms(kw1: string, kw2: string): string[] {
  const set1 = tokenise(kw1)
  const set2 = tokenise(kw2)
  return Array.from(set1).filter(x => set2.has(x))
}

/** Deterministic recommendation from overlap — no LLM required. */
export function ruleBasedJudgement(overlapScore: number, a1Title: string, a2Title: string): Pick<CannibalPair, 'recommendation' | 'fixPlan' | 'severity'> {
  if (overlapScore >= 70) {
    return {
      recommendation: 'merge',
      severity: 'high',
      fixPlan: `Merge “${a1Title}” into “${a2Title}” (or the reverse) and 301-redirect the weaker URL — they target the same intent and split rankings.`,
    }
  }
  if (overlapScore >= 55) {
    return {
      recommendation: 'differentiate',
      severity: 'medium',
      fixPlan: `Rewrite one article so it targets a clearly different sub-intent than the other — keep both pages only if their keywords stop overlapping.`,
    }
  }
  return {
    recommendation: 'monitor',
    severity: 'low',
    fixPlan: 'Shared terms exist but intents may differ — monitor rankings before merging or rewriting.',
  }
}

const MAX_LLM_PAIRS = 8

export async function detectCannibalization(
  articles: Array<{ id: string; title: string; keyword: string; content?: string }>
): Promise<CannibalResult> {
  const pairs: CannibalPair[] = []

  const safe = articles.map(a => ({
    ...a,
    title: (a.title || a.keyword || 'Untitled').trim(),
    keyword: (a.keyword || a.title || '').trim(),
  })).filter(a => a.keyword.length > 0)

  for (let i = 0; i < safe.length; i++) {
    for (let j = i + 1; j < safe.length; j++) {
      const a1 = safe[i]
      const a2 = safe[j]

      const kwOverlap = jaccardSimilarity(a1.keyword, a2.keyword)
      const titleOverlap = jaccardSimilarity(a1.title, a2.title)
      const overlapScore = Math.max(kwOverlap, titleOverlap * 0.8)

      if (overlapScore < 40) continue

      const sharedTerms = getSharedTerms(
        `${a1.keyword} ${a1.title}`,
        `${a2.keyword} ${a2.title}`
      )
      const judged = ruleBasedJudgement(overlapScore, a1.title, a2.title)

      pairs.push({
        article1Id: a1.id,
        article1Title: a1.title,
        article1Keyword: a1.keyword,
        article2Id: a2.id,
        article2Title: a2.title,
        article2Keyword: a2.keyword,
        overlapScore: Math.round(overlapScore),
        sharedTerms,
        ...judged,
      })
    }
  }

  // One batched Haiku call for the worst pairs — never a loop of N LLM calls
  const sortedDraft = pairs.sort((a, b) => b.overlapScore - a.overlapScore)
  const toRefine = sortedDraft.slice(0, MAX_LLM_PAIRS)

  if (toRefine.length > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic()
      const list = toRefine.map((p, i) =>
        `${i + 1}. A:"${p.article1Title}" (kw: ${p.article1Keyword}) vs B:"${p.article2Title}" (kw: ${p.article2Keyword}) — overlap ${p.overlapScore}%`
      ).join('\n')

      const fixResponse = await client.messages.create({
        model: MODEL_FOR.cannibalizationJudge,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `You are an SEO editor judging keyword cannibalisation pairs.

For each numbered pair, choose merge | differentiate | monitor, a one-sentence fixPlan, and severity high|medium|low.

Pairs:
${list}

Respond JSON only:
{ "judgements": [ { "index": 1, "recommendation": "merge", "fixPlan": "...", "severity": "high" } ] }`
        }]
      })

      const text = fixResponse.content[0].type === 'text' ? fixResponse.content[0].text : '{}'
      const data = JSON.parse(text.replace(/```json|```/g, '').trim())
      const judgements: any[] = Array.isArray(data.judgements) ? data.judgements : []

      for (const j of judgements) {
        const idx = Number(j.index) - 1
        if (idx < 0 || idx >= toRefine.length) continue
        const target = toRefine[idx]
        if (j.recommendation === 'merge' || j.recommendation === 'differentiate' || j.recommendation === 'monitor') {
          target.recommendation = j.recommendation
        }
        if (typeof j.fixPlan === 'string' && j.fixPlan.trim()) target.fixPlan = j.fixPlan.trim()
        if (j.severity === 'high' || j.severity === 'medium' || j.severity === 'low') {
          target.severity = j.severity
        }
      }
    } catch {
      // Keep rule-based judgements — check must still succeed
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
