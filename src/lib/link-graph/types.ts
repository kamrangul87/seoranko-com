/**
 * Link Graph Audit — types.
 * Spec: docs/seoranko-link-graph-spec.md
 */

export type LinkSeverity = 'CRITICAL' | 'FAIL' | 'WARN'

export type DomRegion = 'nav' | 'main' | 'footer' | 'sidebar' | 'unknown'

export interface LinkEdge {
  sourceUrl: string
  hrefRaw: string
  hrefResolved: string
  anchorText: string
  anchorImageAlt: string | null
  rel: string | null
  isNofollow: boolean
  isInternal: boolean
  domRegion: DomRegion
  domIndex: number
}

export interface RedirectHop {
  url: string
  status: number
}

export interface LinkTarget {
  urlNormalized: string
  finalStatus: number | null
  redirectHops: number
  redirectChain: RedirectHop[]
  finalUrl: string
  canonicalTarget: string | null
  isIndexable: boolean
  robotsDisallowed: boolean
  inSitemap: boolean
  inlinkCount: number
  depth: number | null
  /** Redirect loop detected during resolution. */
  isRedirectLoop: boolean
}

export interface LinkFinding {
  ruleId: string
  severity: LinkSeverity
  sourceUrl: string | null
  targetUrl: string | null
  evidence: Record<string, unknown>
  suggestedTarget: string | null
}

export interface LinkGraphInput {
  /** Seed / home URL for the audit. */
  seedUrl: string
  /** Registrable host (no www). */
  siteHost: string
  /** HTML keyed by crawled page URL (from Index Diagnosis). */
  htmlByUrl: Record<string, string>
  /** Per-URL indexability from Index Diagnosis. */
  pages: Array<{
    url: string
    httpStatus: number
    crawlDepth: number
    verdict: string
    steps: Array<{ step: string; passed: boolean; evidence: string }>
  }>
  /** Sitemap URLs discovered during crawl. */
  sitemapUrls: string[]
  /** robots.txt body. */
  robotsTxt: string
  /** Optional detected page language for generic-anchor localization. */
  lang?: string
}

export interface LinkGraphResult {
  edges: LinkEdge[]
  targets: LinkTarget[]
  findings: LinkFinding[]
  rankedFindings: LinkFinding[]
  trailingSlashConvention: boolean
  jsSuspected: boolean
  jsSuspectedUrls: string[]
  verdictHeadline: string
  topCauses: Array<{
    ruleId: string
    title: string
    affectedCount: number
    whyItMatters: string
    whatToChange: string
  }>
  ranAt: string
}

export interface FixListRow {
  source_url: string
  current_href: string
  suggested_href: string
  rule_id: string
  reason: string
  dom_region: string
}
