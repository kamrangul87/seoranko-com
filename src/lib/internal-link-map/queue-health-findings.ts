/**
 * Turn mechanical link-health issues into approval-required findings.
 * Never applies HTML and never merges a PR.
 */

import type { RolledPersistCandidate } from '@/lib/fix-strategies/findings-ui/crawl/run-detectors'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import type { LinkHealthIssue } from './link-health'
import { relatedFindingCandidate } from './queue-related-findings'
import { isUtilityPage } from './utility-page'

export function healthFindingCandidate(
  issue: LinkHealthIssue,
): RolledPersistCandidate | null {
  if (!issue.mechanical) return null
  const source = normalizeFixStrategyUrl(issue.sourceUrl) ?? issue.sourceUrl
  const never = {
    requiresApproval: true,
    neverAutoMerge: true,
    linkHealthKind: issue.kind,
    linkHealthHint: issue.hint,
  } as const

  if (issue.kind === 'broken' && issue.href) {
    const rollupKey = ['1', 'auto-fixable', source, issue.href].join('|')
    return {
      topicId: '1',
      kind: 'broken-internal-link/404',
      verdict: 'auto-fixable',
      severity: 'high',
      detail: issue.hint,
      pageUrl: issue.sourceUrl,
      declarationSite: source,
      rollupKey,
      affectedUrlCount: 1,
      rolledUp: false,
      bucket: 'actionable',
      autoFixable: true,
      reportOnly: false,
      surfaceClass: 'finding',
      proposedDiff: { proposed: { href: issue.href, action: 'remove-anchor' } },
      evidenceValues: {
        ...never,
        href: issue.href,
        targetUrl: issue.targetUrl,
        targetHref: issue.href,
      },
      sourceRows: [],
    }
  }

  if (issue.kind === 'redirect' && issue.href && issue.rewriteHref) {
    const rollupKey = ['42', 'auto-rewrite', source, issue.href].join('|')
    return {
      topicId: '42',
      kind: 'redirect-chain/internal',
      verdict: 'auto-rewrite',
      severity: 'moderate',
      detail: issue.hint,
      pageUrl: issue.sourceUrl,
      declarationSite: source,
      rollupKey,
      affectedUrlCount: 1,
      rolledUp: false,
      bucket: 'actionable',
      autoFixable: true,
      reportOnly: false,
      surfaceClass: 'finding',
      proposedDiff: {
        proposed: { href: issue.href, rewriteHref: issue.rewriteHref },
      },
      evidenceValues: {
        ...never,
        href: issue.href,
        rewriteHref: issue.rewriteHref,
        targetUrl: issue.targetUrl,
      },
      sourceRows: [],
    }
  }

  if (issue.kind === 'orphan-footer-only' && issue.href && issue.targetUrl) {
    if (
      isUtilityPage({ url: issue.sourceUrl }) ||
      isUtilityPage({ url: issue.targetUrl, href: issue.href, title: issue.anchorText })
    ) {
      return null
    }
    const related = relatedFindingCandidate(issue.sourceUrl, [
      { href: issue.href, anchorText: issue.anchorText || issue.href },
    ])
    return {
      ...related,
      evidenceValues: {
        ...(related.evidenceValues || {}),
        ...never,
      },
    }
  }

  return null
}

export function healthFindingsFromIssues(
  issues: LinkHealthIssue[],
): RolledPersistCandidate[] {
  const out: RolledPersistCandidate[] = []
  for (const issue of issues) {
    const c = healthFindingCandidate(issue)
    if (c) out.push(c)
  }
  return out
}
