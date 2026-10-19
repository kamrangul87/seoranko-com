/**
 * Pages with zero in-content internal links (outbound crawlable <a href>
 * to same-host content). Offer Related articles fix (approval-required).
 */

import { extractAnchors, isInternalHref, isSkippableHref } from '@/lib/fix-strategies/topic-1/extract-anchors'
import { pickRelatedSiblingUrls, type RelatedTarget } from './fix-add-related'

export type RelatedArticlesVerdict = 'auto-add-related-articles'

export type RelatedArticlesFinding = {
  kind: 'internal-links/no-outbound-content-links'
  verdict: RelatedArticlesVerdict
  pageUrl: string
  detail: string
  severity: 'moderate'
  autoFixable: true
  /** Requires human approval — never auto-merge. */
  requiresApproval: true
  relatedTargets: RelatedTarget[]
}

export type DetectRelatedArticlesResult = {
  findings: RelatedArticlesFinding[]
  ok: Array<{ pageUrl: string; verdict: string }>
}

function countOutboundInternalContentLinks(
  pageUrl: string,
  html: string,
): number {
  let n = 0
  for (const a of extractAnchors(html)) {
    if (isSkippableHref(a.href)) continue
    if (!isInternalHref(a.href, pageUrl)) continue
    // Skip pure hash / self
    try {
      const resolved = new URL(a.href, pageUrl)
      const self = new URL(pageUrl)
      if (resolved.pathname === self.pathname) continue
      n++
    } catch {
      /* skip */
    }
  }
  return n
}

export function detectMissingOutboundInternalLinks(opts: {
  pages: Array<{
    url: string
    html: string
    title?: string | null
    h1?: string | null
    /** Only apply on blog/content paths when true; default: path includes /blog */
    isContentPage?: boolean
  }>
}): DetectRelatedArticlesResult {
  const findings: RelatedArticlesFinding[] = []
  const ok: DetectRelatedArticlesResult['ok'] = []

  const catalog = opts.pages.map((p) => ({
    url: p.url,
    title: p.title,
    h1: p.h1,
  }))

  for (const page of opts.pages) {
    const isContent =
      page.isContentPage ??
      (() => {
        try {
          return /\/blog(\/|$)/i.test(new URL(page.url).pathname)
        } catch {
          return false
        }
      })()
    if (!isContent) {
      ok.push({ pageUrl: page.url, verdict: 'not_content_page' })
      continue
    }

    const outbound = countOutboundInternalContentLinks(page.url, page.html)
    if (outbound > 0) {
      ok.push({ pageUrl: page.url, verdict: 'has_outbound_internal' })
      continue
    }

    const related = pickRelatedSiblingUrls(page.url, catalog, 3)
    if (related.length === 0) {
      ok.push({ pageUrl: page.url, verdict: 'no_siblings' })
      continue
    }

    findings.push({
      kind: 'internal-links/no-outbound-content-links',
      verdict: 'auto-add-related-articles',
      pageUrl: page.url,
      severity: 'moderate',
      autoFixable: true,
      requiresApproval: true,
      relatedTargets: related,
      detail:
        `This blog page has no in-content internal links. Approval-required fix: add a Related articles list linking ${related.length} sibling page(s).`,
    })
  }

  return { findings, ok }
}
