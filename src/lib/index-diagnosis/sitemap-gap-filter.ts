/**
 * Cross-check "linked, absent from sitemap" against other crawl findings.
 * A URL should not be flagged as missing-from-sitemap when it is correctly
 * excluded (dead, redirect alias, or canonical duplicate of a listed URL).
 */

import { normalizeUrl } from '@/lib/supabase/audit-db'
import { expandCanonicalUrlVariants } from '@/lib/index-diagnosis/canonical-equivalence'
import type { FetchedPage } from './crawler'
import type { ExcludedUrlRecord, PageIndexability } from './types'

export interface SitemapGapFilterContext {
  sitemapUrls: string[]
  excluded: ExcludedUrlRecord[]
  fetchedPages: FetchedPage[]
  pages?: PageIndexability[]
}

export type SitemapGapExcludeReason = 'non_200' | 'redirect_target_in_sitemap' | 'canonical_duplicate_in_sitemap'

function norm(u: string): string {
  try {
    return normalizeUrl(u)
  } catch {
    return u.trim().toLowerCase().replace(/\/$/, '')
  }
}

function sitemapSet(urls: string[]): Set<string> {
  return new Set(urls.map(norm))
}

function isListedInSitemap(url: string, inSitemap: Set<string>): boolean {
  for (const v of Array.from(expandCanonicalUrlVariants(url))) {
    if (inSitemap.has(norm(v))) return true
  }
  return false
}

function canonicalTargetInSitemap(page: PageIndexability, inSitemap: Set<string>): string | null {
  const canonStep = page.steps.find((s) => s.step === 'canonical')
  if (!canonStep || canonStep.passed) return null
  const target = canonStep.evidence.match(/Canonical points to different same-host URL: ([^\s]+)/)?.[1]
  if (!target) return null
  return isListedInSitemap(target, inSitemap) ? target : null
}

/** Why this URL should NOT be flagged as missing-from-sitemap, or null if it should stay flagged. */
export function sitemapGapExcludeReason(
  url: string,
  ctx: SitemapGapFilterContext,
): SitemapGapExcludeReason | null {
  const n = norm(url)
  const inSitemap = sitemapSet(ctx.sitemapUrls)

  if (ctx.excluded.some((e) => norm(e.url) === n && e.reason === 'NON_200')) {
    return 'non_200'
  }

  const fetched = ctx.fetchedPages.find((p) => norm(p.url) === n)
  if (fetched && fetched.redirectCount > 0) {
    const dest = norm(fetched.finalUrl)
    if (inSitemap.has(dest)) return 'redirect_target_in_sitemap'
  }

  const pageByRequested = ctx.pages?.find((p) => norm(p.url) === n)
  if (pageByRequested && canonicalTargetInSitemap(pageByRequested, inSitemap)) {
    return 'canonical_duplicate_in_sitemap'
  }

  if (fetched && ctx.pages) {
    const pageByFinal = ctx.pages.find((p) => norm(p.url) === norm(fetched.finalUrl))
    if (pageByFinal && canonicalTargetInSitemap(pageByFinal, inSitemap)) {
      return 'canonical_duplicate_in_sitemap'
    }
    if (fetched.canonicalTags.length > 0) {
      for (const canon of fetched.canonicalTags) {
        try {
          if (isListedInSitemap(canon, inSitemap)) return 'canonical_duplicate_in_sitemap'
        } catch {
          /* skip bad canonical href */
        }
      }
    }
  }

  return null
}

export function shouldFlagAsMissingFromSitemap(url: string, ctx: SitemapGapFilterContext): boolean {
  return sitemapGapExcludeReason(url, ctx) === null
}

export function filterLinkedOnlyUrls(urls: string[], ctx: SitemapGapFilterContext): string[] {
  return urls.filter((u) => shouldFlagAsMissingFromSitemap(u, ctx))
}

export function buildSitemapGapFilterContext(
  coverage: { excluded: ExcludedUrlRecord[]; sitemapDiscoveredUrls?: string[] },
  fetchedPages: FetchedPage[],
  pages?: PageIndexability[],
): SitemapGapFilterContext {
  return {
    sitemapUrls: coverage.sitemapDiscoveredUrls || [],
    excluded: coverage.excluded,
    fetchedPages,
    pages,
  }
}

export function isKnownBadForSitemap(url: string, ctx: SitemapGapFilterContext): boolean {
  return sitemapGapExcludeReason(url, ctx) !== null
}

export const EXCLUDE_REASON_LABELS: Record<SitemapGapExcludeReason, string> = {
  non_200: 'Returns non-200 — dead pages should not be in a sitemap',
  redirect_target_in_sitemap: 'Redirects to a URL already listed in the sitemap',
  canonical_duplicate_in_sitemap: 'Canonical duplicate of a URL already listed in the sitemap',
}
