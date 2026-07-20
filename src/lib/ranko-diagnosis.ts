// src/lib/ranko-diagnosis.ts
// RANKO's diagnostic brain — orchestrates existing tools into a
// prioritised issue report with confidence + risk labels on every finding.
// Uses Claude Sonnet for judgment (as per spec).
/* eslint-disable @typescript-eslint/no-explicit-any */

import Anthropic from '@anthropic-ai/sdk'
import { runGEOAudit } from './geo-auditor'
import { detectCannibalization } from './cannibalization-detector'
import { scoreEntityCoverage, auditHeadingStructure, auditAuthorityLinks } from './aeo-signals'

export type IssueImpact = 'critical' | 'high' | 'medium' | 'low'
export type IssueRisk = 'safe' | 'low-risk' | 'medium-risk' | 'high-risk'
export type IssueCategory = 'technical' | 'content' | 'structural' | 'authority' | 'ai-visibility'

export interface RANKOIssue {
  id: string
  category: IssueCategory
  impact: IssueImpact
  title: string
  whyItHurts: string        // plain English — why this matters for rankings
  fix: string               // specific action to take
  confidence: number        // 0-100 — how confident RANKO is this matters
  risk: IssueRisk           // risk of implementing the fix
  autoFixable: boolean      // can RANKO fix this without user approval?
  estimatedGain: string     // e.g. "likely +2-5 positions on page 2 articles"
  affectedItems?: string[]  // which articles/pages are affected
}

export interface RANKODiagnosis {
  siteUrl: string
  diagnosedAt: string
  overallHealth: 'excellent' | 'good' | 'needs-work' | 'critical'
  healthScore: number        // 0-100
  issues: RANKOIssue[]
  priorityQueue: string[]    // issue IDs in order of "fix this first"
  doNothing: string[]        // things RANKO explicitly says to leave alone
  topThreeActions: string[]  // plain English summary for non-technical users
  estimatedWeeksToImpact: number
}

const client = new Anthropic()

export async function runRANKODiagnosis(
  userId: string,
  siteUrl: string,
  articles: Array<{
    id: string
    title: string
    keyword: string
    content: string
    rank_score?: number
    current_position?: number | null
  }>
): Promise<RANKODiagnosis> {

  const issues: RANKOIssue[] = []

  // === Layer 1: GEO Audit (technical + AI visibility) ===
  let geoIssues: RANKOIssue[] = []
  try {
    const geoResult = await runGEOAudit(siteUrl)

    for (const signal of (geoResult as any).signals || []) {
      if (signal.status === 'pass') continue

      geoIssues.push({
        id: `geo-${signal.id}`,
        category: signal.id?.includes('schema') ? 'technical' :
                  (signal.id?.includes('bot') || signal.id?.includes('llms')) ? 'ai-visibility' : 'technical',
        impact: signal.score < 30 ? 'critical' : signal.score < 60 ? 'high' : 'medium',
        title: signal.name,
        whyItHurts: signal.finding,
        fix: signal.fix,
        confidence: Math.min(100, (signal.weight || 30) + 50),
        risk: 'safe',
        autoFixable: ['llms-txt', 'schema-markup'].includes(signal.id),
        estimatedGain: signal.impact === 'critical'
          ? 'significant improvement in AI citation likelihood'
          : 'moderate improvement in search visibility',
        affectedItems: [siteUrl]
      })
    }
  } catch { /* GEO audit failed — skip, don't crash */ }

  issues.push(...geoIssues)

  // === Layer 2: Content analysis (for each article) ===
  const contentIssues: RANKOIssue[] = []
  const weakArticles: string[] = []
  const stuckArticles: string[] = []

  for (const article of articles.slice(0, 20)) {
    if (!article.content) continue

    const headingAudit = auditHeadingStructure(article.content)
    const authorityAudit = auditAuthorityLinks(article.content)
    const entityScore = scoreEntityCoverage(article.content)

    // Heading issues
    if ((headingAudit as any).grade === 'C' || (headingAudit as any).grade === 'F') {
      const existing = contentIssues.find(i => i.id === 'content-headings')
      if (existing) {
        existing.affectedItems?.push(article.title)
      } else {
        contentIssues.push({
          id: 'content-headings',
          category: 'content',
          impact: 'medium',
          title: 'Question-format H2 headings below target',
          whyItHurts: 'AI engines match queries to question-format headings. Articles without them lose AI citation opportunities.',
          fix: 'Convert H2 headings to question format (How/What/Why/When). Target: 4 of 6 H2s as questions.',
          confidence: 82,
          risk: 'safe',
          autoFixable: true,
          estimatedGain: '+15–25% improvement in AI Overview inclusion likelihood',
          affectedItems: [article.title]
        })
      }
    }

    // Authority link issues
    if ((authorityAudit as any).totalAuthorityLinks < 2) {
      const existing = contentIssues.find(i => i.id === 'content-authority-links')
      if (existing) {
        existing.affectedItems?.push(article.title)
      } else {
        contentIssues.push({
          id: 'content-authority-links',
          category: 'authority',
          impact: 'medium',
          title: 'Low authority external link count',
          whyItHurts: 'Fewer than 2 .gov/.org/.ac.uk links signals low expertise to both Google and AI engines.',
          fix: 'Add 2+ authoritative external links per article (gov.uk, NHS, academic sources, official regulatory bodies).',
          confidence: 75,
          risk: 'safe',
          autoFixable: true,
          estimatedGain: 'Moderate EEAT improvement; named entities increase AI citation rate by ~30%',
          affectedItems: [article.title]
        })
      }
    }

    // Entity coverage
    if ((entityScore as any).grade === 'D' || (entityScore as any).grade === 'F') {
      weakArticles.push(article.title)
    }

    // Stuck articles (ranked 11-30, not improving)
    if (article.current_position && article.current_position >= 11 && article.current_position <= 30) {
      stuckArticles.push(article.title)
    }
  }

  issues.push(...contentIssues)

  // === Layer 3: Entity coverage summary ===
  if (weakArticles.length > 0) {
    issues.push({
      id: 'entity-coverage',
      category: 'content',
      impact: weakArticles.length > 3 ? 'high' : 'medium',
      title: `Low entity density in ${weakArticles.length} article${weakArticles.length > 1 ? 's' : ''}`,
      whyItHurts: 'Sites with 8+ named entities per 1,000 words are cited 3× more by AI engines (Floyi AIRS 2026). Low entity density signals thin expertise.',
      fix: 'Add specific named organisations, people, places, products, and regulations to thin articles. Each article should name at least 5 specific entities.',
      confidence: 78,
      risk: 'safe',
      autoFixable: true,
      estimatedGain: 'Up to 3× increase in AI citation likelihood for affected articles',
      affectedItems: weakArticles
    })
  }

  // === Layer 4: Stuck articles ===
  if (stuckArticles.length > 0) {
    issues.push({
      id: 'stuck-articles',
      category: 'structural',
      impact: 'high',
      title: `${stuckArticles.length} article${stuckArticles.length > 1 ? 's' : ''} stuck on page 2-3`,
      whyItHurts: 'Articles ranking 11–30 are "almost there" — they need targeted improvements, not rewrites. These represent the highest ROI opportunity.',
      fix: 'Run RANKO\'s targeted improve pass on each stuck article: check competitor content gaps, add missing entities, improve answer-first structure.',
      confidence: 88,
      risk: 'low-risk',
      autoFixable: false,
      estimatedGain: '3-8 position improvement likely within 4-8 weeks for page 2 articles',
      affectedItems: stuckArticles
    })
  }

  // === Layer 5: Cannibalisation ===
  try {
    const cannibResult = await detectCannibalization(articles.map(a => ({
      id: a.id, title: a.title, keyword: a.keyword
    })))

    if (cannibResult.highSeverity > 0) {
      issues.push({
        id: 'cannibalisation',
        category: 'structural',
        impact: cannibResult.highSeverity > 2 ? 'critical' : 'high',
        title: `${cannibResult.highSeverity} keyword conflict${cannibResult.highSeverity > 1 ? 's' : ''} detected`,
        whyItHurts: 'Two articles targeting similar keywords split your authority signal. Google can\'t decide which to rank and often ranks neither well.',
        fix: cannibResult.topAction,
        confidence: 85,
        risk: 'medium-risk',
        autoFixable: false,
        estimatedGain: 'Consolidating conflicts typically improves both articles\' positions by 5-15 places',
        affectedItems: cannibResult.pairs.filter(p => p.severity === 'high').map(p => p.article1Title)
      })
    }
  } catch { /* cannibalisation check failed */ }

  // === Layer 6: Use Claude Sonnet to synthesise and prioritise ===
  const issuesSummary = issues.map(i =>
    `[${i.impact.toUpperCase()}] ${i.title}: ${i.whyItHurts} (confidence: ${i.confidence}%)`
  ).join('\n')

  let synthesisData: any = {}
  try {
    const synthesis = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are RANKO, an autonomous SEO strategist with 25 years of experience.

Site: ${siteUrl}
Articles analysed: ${articles.length}
Issues found:
${issuesSummary || 'No issues detected.'}

As a veteran strategist:
1. What is the overall health (excellent/good/needs-work/critical) and health score (0-100)?
2. List the top 3 issues to fix FIRST (by ROI, not by severity alone)
3. What should the user explicitly NOT touch right now? (things that are working)
4. Give 3 plain-English actions a non-technical user can understand
5. How many weeks until they'd expect to see meaningful rank movement if they act now?

Respond JSON only:
{
  "overallHealth": "needs-work",
  "healthScore": 62,
  "priorityQueue": ["issue-id-1", "issue-id-2", "issue-id-3"],
  "doNothing": ["specific thing working well — leave it alone"],
  "topThreeActions": [
    "Action 1 in plain English",
    "Action 2 in plain English",
    "Action 3 in plain English"
  ],
  "estimatedWeeksToImpact": 4
}`
      }]
    })

    const text = synthesis.content[0].type === 'text' ? synthesis.content[0].text : '{}'
    synthesisData = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    synthesisData = {
      overallHealth: 'needs-work',
      healthScore: 60,
      priorityQueue: issues.slice(0, 3).map(i => i.id),
      doNothing: [],
      topThreeActions: issues.slice(0, 3).map(i => i.fix),
      estimatedWeeksToImpact: 6
    }
  }

  // Suppress unused param warning — userId will be used in v3 for cross-user patterns
  void userId

  return {
    siteUrl,
    diagnosedAt: new Date().toISOString(),
    overallHealth: synthesisData.overallHealth || 'needs-work',
    healthScore: synthesisData.healthScore || 60,
    issues: issues.sort((a, b) => {
      const order: Record<IssueImpact, number> = { critical: 0, high: 1, medium: 2, low: 3 }
      return order[a.impact] - order[b.impact]
    }),
    priorityQueue: synthesisData.priorityQueue || issues.slice(0, 3).map(i => i.id),
    doNothing: synthesisData.doNothing || [],
    topThreeActions: synthesisData.topThreeActions || [],
    estimatedWeeksToImpact: synthesisData.estimatedWeeksToImpact || 6
  }
}
