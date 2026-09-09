/**
 * Map GSC Index Insights deltas → Fix Agent / human task issues.
 * Canonical mismatch can use redirect-canonical when both URLs are known.
 * Not-indexed / robots / never-crawled stay human — never auto-"fixed".
 */

import type { PageAuditIssue } from '@/lib/page-audit-engine'
import type { InspectionDelta } from '@/lib/gsc/inspection-deltas'
import { deltaReasonLabel } from '@/lib/gsc/inspection-deltas'

export type InspectionRowForIssues = {
  url: string
  deltas?: InspectionDelta[] | null
  google_canonical?: string | null
  user_canonical?: string | null
  coverage_state?: string | null
}

export function buildGscInspectionFixAgentIssues(
  rows: InspectionRowForIssues[],
): PageAuditIssue[] {
  const issues: PageAuditIssue[] = []

  for (const row of rows) {
    const deltas = Array.isArray(row.deltas) ? row.deltas : []
    for (const d of deltas) {
      const idBase = `gsc-delta-${d.reason}-${encodeURIComponent(row.url)}`
      if (d.reason === 'canonical_mismatch' && row.user_canonical && row.google_canonical) {
        issues.push({
          id: idBase,
          severity: 'warning',
          category: 'gsc-index-insights',
          title: `Canonical mismatch: ${deltaReasonLabel(d.reason)}`,
          description: d.explanation,
          remediation:
            'Align declared canonical with the URL Google selected, or add a mechanical redirect if the non-preferred URL should permanently point at the preferred one.',
          fixMetadata: {
            kind: 'redirect-canonical',
            fromUrl: row.user_canonical,
            toUrl: row.google_canonical,
            evidence: JSON.stringify(d.evidence),
          },
        })
        continue
      }

      // Human tasks — never invent ranking reasons
      const humanKind =
        d.humanTaskKind ||
        (d.reason === 'robots_state_conflict'
          ? 'gsc-robots-conflict'
          : d.reason === 'sitemap_never_crawled'
            ? 'gsc-never-crawled'
            : 'gsc-not-indexed')

      issues.push({
        id: idBase,
        severity: d.reason === 'crawl_indexable_google_not_indexed' ? 'warning' : 'info',
        category: 'gsc-index-insights',
        title: deltaReasonLabel(d.reason),
        description: d.explanation,
        remediation:
          humanKind === 'gsc-not-indexed'
            ? 'Human review: improve page usefulness and request indexing in Search Console if appropriate. SEORANKO will not auto-fix “not indexed”.'
            : humanKind === 'gsc-robots-conflict'
              ? 'Human review: reconcile robots.txt / meta robots with Google’s robotsTxtState.'
              : 'Human review: confirm sitemap inclusion and crawl demand; Google has no recorded lastCrawlTime.',
        fixMetadata: {
          kind: 'gsc-human-delta',
          evidence: `${humanKind}:${JSON.stringify(d.evidence)}`,
          sourceUrls: [row.url],
        },
      })
    }
  }

  return issues
}
