/**
 * Tool-wide "Fix All Issues" — runs every available auto-fix for the
 * current Quality Gate findings, then re-checks. Honest about what still
 * needs a human (dated claims, brand, topic drift, etc.).
 */

import { runQualityGate, type QualityGateResult, type QualityIssue } from '@/lib/article-quality-gate'
import { repairAllMergeArtifacts, applyDeterministicMergeFixes } from '@/lib/merge-artifact-repair'
import { autoSplitDenseParagraphs } from '@/lib/scannability-fixer'
import { scrubInsertionCorruption, hasInsertionCorruption } from '@/lib/sentence-integrity'
import { assertImageUrlsPreserved } from '@/lib/html-text-transform'
import { wordCountBand } from '@/lib/word-count'
import { improveArticle } from '@/lib/article-improver'
import { computePanelScores, type PanelScores } from '@/lib/panel-scores'

export interface FixAllOptions {
  html: string
  keyword: string
  brand?: string
  authorName?: string
  registeredLinkDomains?: string[]
  targetWordCount?: number
  userId?: string
  articleId?: string
  /**
   * Logo policy from brand_settings — when omitted, QG does not require
   * Organization.logo (matches article-v2 / product rule).
   */
  expectOrganizationLogo?: boolean
}

export interface FixAllResult {
  html: string
  qualityGateBefore: QualityGateResult
  qualityGateAfter: QualityGateResult
  fixed: Array<{ id: string; title: string; how: string }>
  stillNeedsManualReview: Array<{ id: string; title: string; reason: string }>
  summary: string
  /** Same HTML the gate scored — keep Write-page rings in sync. */
  panelScores: PanelScores
}

function issueKey(i: QualityIssue): string {
  return `${i.id}::${i.category}`
}

function scoreOpts(html: string, keyword: string) {
  const panel = computePanelScores(html, keyword)
  return {
    eeatScore: panel.eeatScore,
    keywordDensityPct: panel.keywordDensity,
    keywordDensityScore: panel.keywordDensityScore,
  }
}

export async function fixAllArticleIssues(opts: FixAllOptions): Promise<FixAllResult> {
  const {
    keyword,
    brand = '',
    authorName = 'Kamran Gul',
    registeredLinkDomains = [],
    targetWordCount = 2000,
    userId,
    articleId,
    expectOrganizationLogo = false,
  } = opts

  const band = wordCountBand(targetWordCount)
  const gateOpts = {
    brand,
    keyword,
    authorName,
    registeredLinkDomains,
    minWordCount: band.min,
    maxWordCount: band.max,
    userId,
    articleId,
    expectOrganizationLogo,
    ...scoreOpts(opts.html, keyword),
  }

  const qualityGateBefore = await runQualityGate(opts.html, gateOpts)
  let html = qualityGateBefore.articleAfterAutoFix || opts.html
  assertImageUrlsPreserved(opts.html, html)
  const fixed: FixAllResult['fixed'] = []
  const beforeIds = new Set(qualityGateBefore.issues.map(issueKey))

  if (qualityGateBefore.autoFixedCount > 0) {
    fixed.push({
      id: 'quality-gate-autofix',
      title: `Applied ${qualityGateBefore.autoFixedCount} Quality Gate auto-fix(es)`,
      how: 'Brand mismatch rewrite, AI-slop removal, typically reduction, grant-figure hedges, cross-brand link strip, FAQ schema',
    })
  }

  if (hasInsertionCorruption(html) || applyDeterministicMergeFixes(html).fixesMade > 0 || /copy-error|merge/i.test(qualityGateBefore.issues.map(i => i.category).join(','))) {
    const before = html
    const repaired = await repairAllMergeArtifacts(html)
    html = repaired.content
    if (repaired.repairsMade > 0 || html !== before) {
      fixed.push({
        id: 'merge-artifacts',
        title: 'Repaired truncated / merged text',
        how: `${repaired.repairsMade} merge-artifact repair(s)`,
      })
    }
  } else {
    const scrubbed = scrubInsertionCorruption(html)
    if (scrubbed.fixes > 0) {
      html = scrubbed.html
      fixed.push({
        id: 'insertion-scrub',
        title: 'Removed stray insertion fragments',
        how: `${scrubbed.fixes} scrub fix(es)`,
      })
    }
  }

  if (qualityGateBefore.issues.some(i => i.category === 'scannability')) {
    const split = autoSplitDenseParagraphs(html)
    if (split !== html) {
      html = split
      fixed.push({
        id: 'scannability',
        title: 'Split dense paragraphs',
        how: 'Mechanical sentence-boundary paragraph split',
      })
    }
  }

  if (qualityGateBefore.issues.some(i => i.id === 'score-floor-eeat')) {
    try {
      const before = html
      const improved = await improveArticle({
        articleContent: html,
        target: 'eeat',
        currentScore: calculateEEATScore(html),
        keyword,
        title: keyword,
        brand,
      })
      html = improved.improvedContent || html
      if (html !== before) {
        fixed.push({
          id: 'score-floor-eeat',
          title: 'Improved E-E-A-T signals',
          how: improved.changesSummary || 'E-E-A-T improve pass',
        })
      }
    } catch (err) {
      console.warn('[fix-all] E-E-A-T improve failed:', err)
    }
  }

  if (qualityGateBefore.issues.some(i => i.id === 'score-floor-keyword-density')) {
    try {
      const before = html
      const dens = analyzeKeywordDensity(html, primaryTopicPhrase(keyword) || keyword)
      const improved = await improveArticle({
        articleContent: html,
        target: 'keyword_density',
        currentScore: dens.score,
        keyword,
        title: keyword,
        brand,
      })
      html = improved.improvedContent || html
      if (html !== before) {
        fixed.push({
          id: 'score-floor-keyword-density',
          title: 'Improved keyword density',
          how: improved.changesSummary || 'Keyword density improve pass',
        })
      }
    } catch (err) {
      console.warn('[fix-all] keyword density improve failed:', err)
    }
  }

  if (qualityGateBefore.issues.some(i => i.id === 'score-floor-fact-sourcing')) {
    try {
      const before = html
      const improved = await improveArticle({
        articleContent: html,
        target: 'fact_sourcing',
        currentScore: 30,
        keyword,
        title: keyword,
        brand,
      })
      html = improved.improvedContent || html
      if (html !== before) {
        fixed.push({
          id: 'score-floor-fact-sourcing',
          title: 'Improved fact sourcing',
          how: improved.changesSummary || 'Fact sourcing improve pass',
        })
      }
    } catch (err) {
      console.warn('[fix-all] fact sourcing improve failed:', err)
    }
  }

  html = scrubInsertionCorruption(html).html
  assertImageUrlsPreserved(opts.html, html)
  const qualityGateAfter = await runQualityGate(html, {
    ...gateOpts,
    ...scoreOpts(html, keyword),
  })
  html = qualityGateAfter.articleAfterAutoFix || html
  assertImageUrlsPreserved(opts.html, html)

  if (qualityGateAfter.autoFixedCount > 0 && qualityGateAfter.autoFixedCount !== qualityGateBefore.autoFixedCount) {
    fixed.push({
      id: 'quality-gate-second-pass',
      title: `Second-pass Quality Gate auto-fixed ${qualityGateAfter.autoFixedCount} more`,
      how: 'Re-ran gate after repairs',
    })
  }

  const stillNeedsManualReview = qualityGateAfter.issues
    .filter(i =>
      (i.severity === 'critical' || i.severity === 'warning') &&
      i.verificationStatus !== 'auto-verified'
    )
    .map(i => ({
      id: i.id,
      title: i.title,
      reason: i.actionHint ||
        (i.verificationDetail
          ? i.verificationDetail
          : i.autoFixable
            ? 'Auto-fixable but still present after Fix All — needs another pass or manual edit'
            : (i.description || 'Requires human confirmation or a brand/context setting')),
    }))

  const afterIds = new Set(qualityGateAfter.issues.map(issueKey))
  for (const issue of qualityGateBefore.issues) {
    if (!afterIds.has(issueKey(issue)) && !fixed.some(f => f.id === issue.id)) {
      fixed.push({
        id: issue.id,
        title: issue.title,
        how: issue.autoFixDescription || 'Cleared by Fix All pipeline',
      })
    }
  }
  void beforeIds

  const summary =
    stillNeedsManualReview.length === 0
      ? `Fixed ${fixed.length} item(s). Quality Gate score ${qualityGateBefore.score} → ${qualityGateAfter.score}. Ready for a final human skim.`
      : `Fixed ${fixed.length} item(s). Score ${qualityGateBefore.score} → ${qualityGateAfter.score}. ${stillNeedsManualReview.length} still need manual review — Fix All does not claim 100% when a human must confirm.`

  return {
    html,
    qualityGateBefore,
    qualityGateAfter,
    fixed,
    stillNeedsManualReview,
    summary,
    panelScores: computePanelScores(html, keyword),
  }
}
