/**
 * Join crawl data onto resolved targets and compute inlink counts.
 */

import { normalizeLinkUrl } from './normalize'
import { matchRobotsForUrl } from '@/lib/index-diagnosis/robots-parser'
import type { LinkEdge, LinkGraphInput, LinkTarget } from './types'

function canonicalFromPage(
  page: LinkGraphInput['pages'][number] | undefined,
): string | null {
  if (!page) return null
  const step = page.steps.find((s) => s.step === 'canonical')
  if (!step) return null
  if (step.evidence.startsWith('Canonical self-reference: ')) {
    return step.evidence.slice('Canonical self-reference: '.length).trim()
  }
  const equiv = step.evidence.match(/equivalent URL: (.+)$/)
  if (equiv) return equiv[1]!.trim()
  const mismatch = step.evidence.match(
    /Canonical points to different same-host URL: ([^\s]+)/,
  )
  if (mismatch) return mismatch[1]!.trim()
  return null
}

function isIndexableFromPage(page: LinkGraphInput['pages'][number] | undefined): boolean {
  if (!page) return true
  const meta = page.steps.find((s) => s.step === 'meta_robots')
  const x = page.steps.find((s) => s.step === 'x_robots')
  if (meta && !meta.passed) return false
  if (x && !x.passed) return false
  return true
}

export function enrichTargets(
  resolved: Array<
    Omit<
      LinkTarget,
      'canonicalTarget' | 'isIndexable' | 'robotsDisallowed' | 'inSitemap' | 'inlinkCount' | 'depth'
    >
  >,
  edges: LinkEdge[],
  input: LinkGraphInput,
  trailingSlash: boolean,
): LinkTarget[] {
  const sitemapSet = new Set(
    input.sitemapUrls
      .map((u) => normalizeLinkUrl(u, { trailingSlash }) || u)
      .map((u) => u.replace(/\/$/, '')),
  )
  // Also keep exact forms
  for (const u of input.sitemapUrls) {
    const n = normalizeLinkUrl(u, { trailingSlash })
    if (n) sitemapSet.add(n)
  }

  const pageByUrl = new Map<string, LinkGraphInput['pages'][number]>()
  for (const p of input.pages) {
    const n = normalizeLinkUrl(p.url, { trailingSlash }) || p.url
    pageByUrl.set(n, p)
    pageByUrl.set(p.url, p)
  }

  const inlinkCounts = new Map<string, number>()
  for (const e of edges) {
    if (!e.isInternal) continue
    const key = e.hrefResolved
    inlinkCounts.set(key, (inlinkCounts.get(key) || 0) + 1)
  }

  return resolved.map((r) => {
    const page = pageByUrl.get(r.urlNormalized) || pageByUrl.get(r.finalUrl)
    const robots = matchRobotsForUrl(input.robotsTxt, r.urlNormalized)
    const canon = canonicalFromPage(page)
    const inSitemap =
      sitemapSet.has(r.urlNormalized) ||
      sitemapSet.has(r.urlNormalized.replace(/\/$/, '')) ||
      Array.from(sitemapSet).some((s) => s.replace(/\/$/, '') === r.urlNormalized.replace(/\/$/, ''))

    return {
      ...r,
      canonicalTarget: canon,
      isIndexable: isIndexableFromPage(page) && robots.allowed,
      robotsDisallowed: !robots.allowed,
      inSitemap,
      inlinkCount: inlinkCounts.get(r.urlNormalized) || 0,
      depth: page?.crawlDepth ?? null,
    }
  })
}
