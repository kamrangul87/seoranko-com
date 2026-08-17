/**
 * Tool-wide "Fix All Issues" — runs every available auto-fix for the
 * current Quality Gate findings, then re-checks. Honest about what still
 * needs a human (dated claims, brand, topic drift, etc.).
 */

import { runQualityGate, type QualityGateResult, type QualityIssue } from '@/lib/article-quality-gate'
import { repairAllMergeArtifacts, applyDeterministicMergeFixes } from '@/lib/merge-artifact-repair'
import { autoSplitDenseParagraphs } from '@/lib/scannability-fixer'
import { scrubInsertionCorruption, hasInsertionCorruption } from '@/lib/sentence-integrity'
import { wordCountBand } from '@/lib/word-count'

export interface FixAllOptions {
  html: string
  keyword: string
  brand?: string
  authorName?: string
  registeredLinkDomains?: string[]
  targetWordCount?: number
  userId?: string
  articleId?: string
}

export interface FixAllResult {
  html: string
  qualityGateBefore: QualityGateResult
  qualityGateAfter: QualityGateResult
  fixed: Array<{ id: string; title: string; how: string }>
  stillNeedsManualReview: Array<{ id: string; title: string; reason: string }>
  summary: string
}

function issueKey(i: QualityIssue): string {
  return `${i.id}::${i.category}`
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
  }

  const qualityGateBefore = await runQualityGate(opts.html, gateOpts)
  let html = qualityGateBefore.articleAfterAutoFix || opts.html
  const fixed: FixAllResult['fixed'] = []
  const beforeIds = new Set(qualityGateBefore.issues.map(issueKey))

  // Track autofixes already applied inside runQualityGate
  if (qualityGateBefore.autoFixedCount > 0) {
    const cleared = qualityGateBefore.issues.filter(i => i.autoFixable)
    // Issues still listed after autofix weren't fully cleared; infer from score path
    fixed.push({
      id: 'quality-gate-autofix',
      title: `Applied ${qualityGateBefore.autoFixedCount} Quality Gate auto-fix(es)`,
      how: 'AI-slop removal, typically reduction, grant-figure hedges, cross-brand link strip, FAQ schema',
    })
    void cleared
  }

  // Merge-artifact / insertion-corruption repair
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

  // Scannability — split dense paragraphs when flagged
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

  // Final scrub + re-run gate for honest residual report
  html = scrubInsertionCorruption(html).html
  const qualityGateAfter = await runQualityGate(html, gateOpts)
  html = qualityGateAfter.articleAfterAutoFix || html

  if (qualityGateAfter.autoFixedCount > 0 && qualityGateAfter.autoFixedCount !== qualityGateBefore.autoFixedCount) {
    fixed.push({
      id: 'quality-gate-second-pass',
      title: `Second-pass Quality Gate auto-fixed ${qualityGateAfter.autoFixedCount} more`,
      how: 'Re-ran gate after repairs',
    })
  }

  const stillNeedsManualReview = qualityGateAfter.issues
    .filter(i => i.severity === 'critical' || i.severity === 'warning')
    .map(i => ({
      id: i.id,
      title: i.title,
      reason: i.autoFixable
        ? 'Auto-fixable but still present after Fix All — needs another pass or manual edit'
        : (i.description || 'Requires human confirmation or a brand/context setting'),
    }))

  // Prefer issues that were present before and cleared
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
  }
}
