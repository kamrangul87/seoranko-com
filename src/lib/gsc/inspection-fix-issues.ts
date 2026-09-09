/**
 * Map GSC Index Insights deltas → Fix Agent / human task issues.
 * Canonical mismatch can use redirect-canonical when both URLs are known.
 * Other deltas stay human — never auto-"fixed", never ranking speculation.
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

function remediationFor(humanKind: string): string {
  switch (humanKind) {
    case 'gsc-not-indexed':
      return 'Human review: improve page usefulness and request indexing in Search Console if appropriate. SEORANKO will not auto-fix “not indexed”.'
    case 'gsc-robots-conflict':
      return 'Human review: reconcile robots.txt / meta robots with Google’s robotsTxtState.'
    case 'gsc-never-crawled':
      return 'Human review: confirm sitemap inclusion and crawl demand; Google has no recorded lastCrawlTime.'
    case 'gsc-blocked-but-indexed':
      return 'Human review: our crawl says blocked while Google reports indexed — check accidental indexation risk.'
    case 'gsc-indexing-directive':
      return 'Human review: reconcile noindex directives with Google’s indexingState enum.'
    case 'gsc-fetch-state':
      return 'Human review: reconcile our HTTP fetch result with Google’s pageFetchState.'
    case 'gsc-post-fix-recrawl':
      return 'Observed difference: Google has not recorded a successful crawl since the verified fix. Request indexing if appropriate; SEORANKO does not mutate intervention lifecycle from Index Insights.'
    case 'gsc-historical-transition':
      return 'Observed historical transition in Google’s recorded view — review prior inspection evidence.'
    case 'gsc-canonical-mismatch':
      return 'Align declared canonical with the URL Google selected, or add a mechanical redirect if appropriate.'
    default:
      return 'Human review of Google Index Insights evidence — observed difference only.'
  }
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
          remediation: remediationFor('gsc-canonical-mismatch'),
          fixMetadata: {
            kind: 'redirect-canonical',
            fromUrl: row.user_canonical,
            toUrl: row.google_canonical,
            evidence: JSON.stringify(d.evidence),
          },
        })
        continue
      }

      const humanKind = d.humanTaskKind || 'gsc-not-indexed'
      issues.push({
        id: idBase,
        severity:
          d.reason === 'crawl_indexable_google_not_indexed' ||
          d.reason === 'crawl_blocked_google_indexed'
            ? 'warning'
            : 'info',
        category: 'gsc-index-insights',
        title: deltaReasonLabel(d.reason),
        description: d.explanation,
        remediation: remediationFor(humanKind),
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
