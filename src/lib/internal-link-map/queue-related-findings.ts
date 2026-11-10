/**
 * Build approval-required Related reading findings.
 * Never applies HTML and never merges a PR.
 */

import { cleanRelatedAnchor } from '@/lib/fix-strategies/related-articles/anchors'
import { MAX_RELATED_TARGETS } from '@/lib/fix-strategies/related-articles/fix-add-related'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import type { RolledPersistCandidate } from '@/lib/fix-strategies/findings-ui/crawl/run-detectors'

export const RELATED_LINK_TOPIC = 'related'
export const RELATED_LINK_VERDICT = 'auto-add-related-articles'
export const MAX_QUEUED_SOURCES = 200

export type RelatedLinkItem = {
  sourceUrl: string
  href: string
  anchorText: string
  reason?: string
}

export function groupRelatedLinkItems(
  items: RelatedLinkItem[],
): Array<{ sourceUrl: string; targets: Array<{ href: string; anchorText: string }> }> {
  const groups = new Map<string, Array<{ href: string; anchorText: string }>>()
  const seen = new Set<string>()
  for (const item of items) {
    const source = (normalizeFixStrategyUrl(item.sourceUrl) ?? item.sourceUrl).trim()
    const href = item.href.trim()
    const anchor = cleanRelatedAnchor({
      stored: item.anchorText,
      anchorText: item.anchorText,
      href,
    })
    if (!source || !href || !anchor) continue
    const k = `${source}\0${href}`
    if (seen.has(k)) continue
    seen.add(k)
    const list = groups.get(source) ?? []
    if (list.length >= MAX_RELATED_TARGETS) continue
    list.push({ href, anchorText: anchor })
    groups.set(source, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_QUEUED_SOURCES)
    .map(([sourceUrl, targets]) => ({ sourceUrl, targets }))
}

export function relatedFindingCandidate(
  sourceUrl: string,
  targets: Array<{ href: string; anchorText: string }>,
): RolledPersistCandidate {
  const decl = normalizeFixStrategyUrl(sourceUrl) ?? sourceUrl
  const rollupKey = [RELATED_LINK_TOPIC, RELATED_LINK_VERDICT, decl].join('|')
  return {
    topicId: RELATED_LINK_TOPIC,
    kind: 'internal-links/related-articles',
    verdict: RELATED_LINK_VERDICT,
    severity: null,
    detail: `Add related reading links to ${targets.map((t) => t.href).join(', ')} (approval required — nothing was applied).`,
    pageUrl: sourceUrl,
    declarationSite: decl,
    rollupKey,
    affectedUrlCount: 1,
    rolledUp: false,
    bucket: 'actionable',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'finding',
    proposedDiff: { proposed: { relatedTargets: targets } },
    evidenceValues: { relatedTargets: targets, requiresApproval: true, neverAutoMerge: true },
    sourceRows: [],
  }
}
