/**
 * Exclude non-canonical duplicate URLs from sitemap generation.
 * Shared canonical-equivalence rules with Index Diagnosis — directory ↔ index.html
 * on the same path are one page; list only the preferred representative URL.
 */

import { normalizeUrl } from '@/lib/supabase/audit-db'
import {
  expandCanonicalUrlVariants,
  isIndexHtmlUrl,
  parseCanonicalMismatchEvidence,
} from '@/lib/index-diagnosis/canonical-equivalence'
import type { PageIndexability } from '@/lib/index-diagnosis/types'

export interface SitemapCanonicalExclusion {
  url: string
  keptUrl: string
  reason: string
}

function parseCanonicalHrefFromHtml(html: string): string | null {
  const tag = html.match(/<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i)?.[0]
  if (!tag) return null
  return tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || null
}

/** Resolve canonical href for a crawled page from HTML or indexability step evidence. */
export function canonicalHrefForPage(
  page: PageIndexability,
  htmlByUrl?: Record<string, string>,
): string | null {
  const html = htmlByUrl?.[page.url]
  if (html) {
    const fromHtml = parseCanonicalHrefFromHtml(html)
    if (fromHtml) return fromHtml
  }

  const step = page.steps.find((s) => s.step === 'canonical')
  if (!step) return null

  if (step.evidence.startsWith('Canonical self-reference: ')) {
    return step.evidence.slice('Canonical self-reference: '.length).trim()
  }
  if (step.evidence.includes('equivalent URL:')) {
    return step.evidence.match(/equivalent URL: (.+)$/)?.[1]?.trim() || null
  }
  const mismatch = parseCanonicalMismatchEvidence(step.evidence)
  if (mismatch) return mismatch.canonicalUrl

  return null
}

/** Stable group key for directory ↔ index.html variant clusters. */
export function canonicalVariantGroupKey(url: string): string {
  return Array.from(expandCanonicalUrlVariants(url)).sort()[0]!
}

/**
 * Pick one representative URL per equivalent cluster for sitemap listing.
 * Prefer the directory-style URL over index.html when both are indexable.
 */
export function pickSitemapRepresentative(pages: PageIndexability[]): PageIndexability {
  const nonIndexHtml = pages.filter((p) => !isIndexHtmlUrl(p.url))
  const pool = nonIndexHtml.length > 0 ? nonIndexHtml : pages
  return pool.slice().sort((a, b) => a.url.length - b.url.length || a.url.localeCompare(b.url))[0]!
}

/**
 * Filter INDEXABLE pages to those that should appear in sitemap.xml.
 * Drops non-canonical duplicates (e.g. /blog/index.html when /blog is also indexable).
 */
export function filterPagesForSitemapInclusion(
  pages: PageIndexability[],
  htmlByUrl?: Record<string, string>,
): { pages: PageIndexability[]; exclusions: SitemapCanonicalExclusion[] } {
  const indexable = pages.filter(
    (p) => p.verdict === 'INDEXABLE' && p.httpStatus >= 200 && p.httpStatus < 300,
  )

  const groups = new Map<string, PageIndexability[]>()
  for (const page of indexable) {
    const key = canonicalVariantGroupKey(page.url)
    const list = groups.get(key) || []
    list.push(page)
    groups.set(key, list)
  }

  const included: PageIndexability[] = []
  const exclusions: SitemapCanonicalExclusion[] = []

  for (const groupPages of Array.from(groups.values())) {
    if (groupPages.length === 1) {
      included.push(groupPages[0]!)
      continue
    }

    const kept = pickSitemapRepresentative(groupPages)
    included.push(kept)

    for (const page of groupPages) {
      if (page.url === kept.url) continue
      exclusions.push({
        url: page.url,
        keptUrl: kept.url,
        reason: `Canonical duplicate of ${kept.url} (directory/index.html variant cluster)`,
      })
    }
  }

  // Also exclude pages whose canonical href points to another included URL (non-self)
  const includedNorm = new Set(included.map((p) => normalizeUrl(p.url)))
  const afterCanonicalTarget: PageIndexability[] = []

  for (const page of included) {
    const canon = canonicalHrefForPage(page, htmlByUrl)
    if (!canon) {
      afterCanonicalTarget.push(page)
      continue
    }
    const canonNorm = normalizeUrl(canon)
    const pageNorm = normalizeUrl(page.url)
    if (canonNorm === pageNorm) {
      afterCanonicalTarget.push(page)
      continue
    }

    const canonVariants = expandCanonicalUrlVariants(canon)
    let pointsToIncluded = false
    for (const v of Array.from(canonVariants)) {
      if (includedNorm.has(normalizeUrl(v)) && normalizeUrl(v) !== pageNorm) {
        pointsToIncluded = true
        exclusions.push({
          url: page.url,
          keptUrl: normalizeUrl(v),
          reason: `Page canonical points to ${canon}, which is already listed`,
        })
        break
      }
    }
    if (!pointsToIncluded) {
      afterCanonicalTarget.push(page)
    }
  }

  return { pages: afterCanonicalTarget, exclusions }
}
