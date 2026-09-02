/**
 * Permanent multi-site audit fixture contracts.
 * Each fixture declares EXACT expected findings — positive and negative.
 */

import type { LinkSeverity } from '@/lib/link-graph/types'

export type FixtureId =
  | 'canonical-and-redirects'
  | 'broken-links-and-orphans'
  | 'duplicate-content'
  | 'js-rendered-spa'

export interface FixturePageDef {
  /** Path relative to fixture origin, e.g. /blog/index.html */
  path: string
  /** Filename under pages/ */
  file: string
  depth: number
  httpStatus?: number
  /** When true, page is discovered but excluded as NON_200 (no HTML analysis). */
  excludeAsNon200?: boolean
}

export interface ExpectedCanonicalVerdict {
  path: string
  verdict: 'INDEXABLE' | 'AT_RISK' | 'BLOCKED'
  canonicalPassed: boolean
  /** Substring that must appear in canonical evidence when present. */
  evidenceIncludes?: string
}

export interface ExpectedFollowUp {
  kind: string
  /** Path that must appear in affectedUrls */
  affectedPath: string
}

export interface ExpectedSitemap {
  /** Paths that MUST appear in generated sitemap.xml */
  mustInclude: string[]
  /** Paths that MUST NOT appear */
  mustExclude: string[]
}

export interface ExpectedFixAgent {
  /** fixMetadata.kind values that must be present */
  autoKindsOnGithub: string[]
  /** Issues that must be human on github */
  humanKindsOnGithub?: string[]
  /** Same auto kinds must become human / not auto on universal-tag when server-only */
  serverOnlyKinds?: string[]
}

export interface ExpectedLinkFinding {
  ruleId: string
  severity?: LinkSeverity
  /** Path fragment that must appear in source or target */
  urlIncludes?: string
  count?: number
}

export interface FixtureExpectations {
  /** Exact page verdicts for canonical / indexability. */
  pages: ExpectedCanonicalVerdict[]
  followUps?: ExpectedFollowUp[]
  /** Follow-up kinds that must NOT appear. */
  followUpsAbsent?: string[]
  sitemap: ExpectedSitemap
  fixAgent?: ExpectedFixAgent
  /** Duplicate cohort: path patterns that must be flagged / not flagged. */
  duplicate?: {
    flaggedPathPatternIncludes?: string
    uniquePathMustNotBeInFlaggedCohort?: string
  }
  linkGraph?: {
    mustFind: ExpectedLinkFinding[]
    mustNotFindRuleIds: string[]
  }
  spa?: {
    jsSuspected: boolean
    /** Structure findings suppressed when JS suspected */
    suppressRuleIds: string[]
  }
}

export interface FixtureManifest {
  id: FixtureId
  description: string
  origin: string
  seedPath: string
  pages: FixturePageDef[]
  sitemapPaths: string[]
  robotsTxt: string
  expectations: FixtureExpectations
  /**
   * Mock HTTP map for link-graph resolver (absolute URLs).
   * status + optional Location for redirects.
   */
  linkResolveMap?: Record<string, { status: number; location?: string }>
}
