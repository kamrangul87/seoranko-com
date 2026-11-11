/**
 * Link health from crawl edges + stored HTML. Mechanical items are queued
 * through the existing approval flow — never auto-merged.
 */

import { isBareUrlAnchor, isGenericAnchor } from '@/lib/link-graph/generic-anchors'
import { decodeHtmlEntities } from '@/lib/fix-strategies/related-articles/anchors'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import {
  anchorsMatchingHref,
  isChromeRegion,
  isContentRegion,
  type LinkRegion,
} from './link-placement'
import { overlayEdgeStatuses } from './load-map'
import type { CrawlLinkEdge, CrawlLinkPage } from './types'
import { hrefMatchKeys } from './obsolete-related'
import { isUtilityPage } from './utility-page'

export const TOO_MANY_OUTLINKS = 80

export type LinkHealthKind =
  | 'broken'
  | 'redirect'
  | 'duplicate'
  | 'generic-anchor'
  | 'bare-url-anchor'
  | 'orphan-footer-only'
  | 'too-many-outlinks'

export type LinkHealthPage = {
  url: string
  title: string | null
  h1: string | null
  html: string | null
  httpStatus: number | null
  finalUrl?: string | null
  jobStatus?: string
}

export type LinkHealthIssue = {
  id: string
  kind: LinkHealthKind
  sourceUrl: string
  targetUrl: string | null
  href: string | null
  anchorText: string
  hint: string
  mechanical: boolean
  neverAutoMerge: true
  rewriteHref?: string | null
}

function norm(url: string, base?: string): string {
  return normalizeFixStrategyUrl(url, base) ?? url
}

function hrefOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}` || '/'
  } catch {
    return url
  }
}

function isInContentInlink(region: LinkRegion): boolean {
  if (isChromeRegion(region)) return false
  if (region === 'after-body') return false
  return isContentRegion(region) || region === 'aside' || region === 'other'
}

function regionForEdge(
  html: string | null | undefined,
  href: string,
  pageUrl: string,
): LinkRegion | null {
  if (!html) return null
  const matches = anchorsMatchingHref(html, href, pageUrl)
  if (matches.length === 0) return null
  if (matches.some((a) => isInContentInlink(a.region))) return 'article'
  return matches[0]!.region
}

function pathHint(url: string): string {
  try {
    return new URL(url).pathname || url
  } catch {
    return url
  }
}

/** URLs/paths that currently have at least one in-content inlink (not nav/footer). */
export function collectInContentInlinkKeys(input: {
  originUrl: string
  edges: CrawlLinkEdge[]
  htmlByUrl?: Record<string, string | null | undefined>
}): Set<string> {
  const origin = input.originUrl
  const htmlByUrl = new Map<string, string>()
  if (input.htmlByUrl) {
    for (const [url, html] of Object.entries(input.htmlByUrl)) {
      if (html) htmlByUrl.set(norm(url, origin), html)
    }
  }
  const keys = new Set<string>()
  for (const e of input.edges) {
    const source = norm(e.sourceUrl, origin)
    const target = norm(e.targetUrl, origin)
    const html = htmlByUrl.get(source)
    const region = regionForEdge(html, e.hrefRaw, source)
    if (!region || !isInContentInlink(region)) continue
    for (const k of hrefMatchKeys(target, origin)) keys.add(k)
    for (const k of hrefMatchKeys(e.hrefRaw, origin)) keys.add(k)
  }
  return keys
}

export function detectLinkHealthIssues(input: {
  originUrl: string
  homepageUrl?: string
  pages: LinkHealthPage[]
  edges: CrawlLinkEdge[]
  htmlByUrl?: Record<string, string | null | undefined>
}): LinkHealthIssue[] {
  const origin = input.originUrl
  const home = norm(input.homepageUrl ?? origin, origin)
  const pages: CrawlLinkPage[] = input.pages.map((p) => ({
    url: norm(p.url, origin),
    httpStatus: p.httpStatus,
    finalUrl: p.finalUrl ?? null,
    jobStatus:
      p.httpStatus != null && p.httpStatus >= 400
        ? 'failed'
        : p.jobStatus === 'failed'
          ? 'failed'
          : 'crawled',
  }))
  const htmlByUrl = new Map<string, string>()
  for (const p of input.pages) {
    const key = norm(p.url, origin)
    const html = p.html ?? input.htmlByUrl?.[p.url] ?? input.htmlByUrl?.[key]
    if (html) htmlByUrl.set(key, html)
  }
  if (input.htmlByUrl) {
    for (const [url, html] of Object.entries(input.htmlByUrl)) {
      if (html) htmlByUrl.set(norm(url, origin), html)
    }
  }
  const titleByUrl = new Map<string, string>()
  for (const p of input.pages) {
    const t = decodeHtmlEntities((p.h1 || p.title || '').trim())
    if (t) titleByUrl.set(norm(p.url, origin), t)
  }

  const edges = overlayEdgeStatuses(input.edges, pages, origin).map((e) => ({
    ...e,
    sourceUrl: norm(e.sourceUrl, origin),
    targetUrl: norm(e.targetUrl, origin),
  }))

  const issues: LinkHealthIssue[] = []
  const seen = new Set<string>()
  const push = (issue: LinkHealthIssue) => {
    if (seen.has(issue.id)) return
    seen.add(issue.id)
    issues.push(issue)
  }

  const inbound = new Map<string, CrawlLinkEdge[]>()
  const outbound = new Map<string, CrawlLinkEdge[]>()
  for (const e of edges) {
    const ins = inbound.get(e.targetUrl) ?? []
    ins.push(e)
    inbound.set(e.targetUrl, ins)
    const outs = outbound.get(e.sourceUrl) ?? []
    outs.push(e)
    outbound.set(e.sourceUrl, outs)
  }

  for (const e of edges) {
    const broken =
      (e.targetHttpStatus != null && e.targetHttpStatus >= 400) ||
      pages.find((p) => p.url === e.targetUrl)?.jobStatus === 'failed'
    if (broken) {
      push({
        id: `broken|${e.sourceUrl}|${e.hrefRaw}`,
        kind: 'broken',
        sourceUrl: e.sourceUrl,
        targetUrl: e.targetUrl,
        href: e.hrefRaw,
        anchorText: e.anchorText,
        hint: `Remove the broken link to ${pathHint(e.targetUrl)} so visitors are not sent to an error page.`,
        mechanical: true,
        neverAutoMerge: true,
      })
    }
    const redirected =
      e.isRedirect ||
      (e.targetHttpStatus != null &&
        e.targetHttpStatus >= 300 &&
        e.targetHttpStatus < 400)
    if (redirected) {
      const rewriteHref = e.targetFinalUrl ? hrefOf(e.targetFinalUrl) : null
      push({
        id: `redirect|${e.sourceUrl}|${e.hrefRaw}`,
        kind: 'redirect',
        sourceUrl: e.sourceUrl,
        targetUrl: e.targetUrl,
        href: e.hrefRaw,
        anchorText: e.anchorText,
        hint: rewriteHref
          ? `Rewrite this link to ${rewriteHref} (the URL that already returns 200) instead of hopping through a redirect.`
          : 'Point this link at the final URL instead of a redirect.',
        mechanical: Boolean(rewriteHref),
        neverAutoMerge: true,
        rewriteHref,
      })
    }
    if (isGenericAnchor(e.anchorText)) {
      push({
        id: `generic-anchor|${e.sourceUrl}|${e.hrefRaw}|${e.anchorText}`,
        kind: 'generic-anchor',
        sourceUrl: e.sourceUrl,
        targetUrl: e.targetUrl,
        href: e.hrefRaw,
        anchorText: e.anchorText,
        hint: `Replace “${e.anchorText}” with a short descriptive phrase from the destination heading — not “click here” or “read more”.`,
        mechanical: false,
        neverAutoMerge: true,
      })
    }
    if (isBareUrlAnchor(e.anchorText)) {
      push({
        id: `bare-url-anchor|${e.sourceUrl}|${e.hrefRaw}`,
        kind: 'bare-url-anchor',
        sourceUrl: e.sourceUrl,
        targetUrl: e.targetUrl,
        href: e.hrefRaw,
        anchorText: e.anchorText,
        hint: 'Replace the pasted URL with a descriptive heading so people know where the link goes.',
        mechanical: false,
        neverAutoMerge: true,
      })
    }
  }

  const dupSeen = new Set<string>()
  for (const e of edges) {
    const key = `${e.sourceUrl}\0${e.targetUrl}`
    if (dupSeen.has(key)) continue
    const copies = edges.filter(
      (o) => o.sourceUrl === e.sourceUrl && o.targetUrl === e.targetUrl,
    )
    if (copies.length < 2) continue
    dupSeen.add(key)
    push({
      id: `duplicate|${e.sourceUrl}|${e.targetUrl}`,
      kind: 'duplicate',
      sourceUrl: e.sourceUrl,
      targetUrl: e.targetUrl,
      href: e.hrefRaw,
      anchorText: e.anchorText,
      hint: `This page links to ${pathHint(e.targetUrl)} ${copies.length} times. Keep one in-content link and remove the extras.`,
      mechanical: false,
      neverAutoMerge: true,
    })
  }

  for (const [source, outs] of outbound) {
    const html = htmlByUrl.get(source)
    const contentOut = outs.filter((e) => {
      const region = regionForEdge(html, e.hrefRaw, source)
      if (!region) return true
      return !isChromeRegion(region)
    })
    if (contentOut.length >= TOO_MANY_OUTLINKS) {
      push({
        id: `too-many-outlinks|${source}`,
        kind: 'too-many-outlinks',
        sourceUrl: source,
        targetUrl: null,
        href: null,
        anchorText: '',
        hint: `This page has ${contentOut.length} outgoing internal links. Keep the useful in-article ones and trim the rest so the page stays readable.`,
        mechanical: false,
        neverAutoMerge: true,
      })
    }
  }

  const htmlRecord: Record<string, string> = {}
  for (const [k, v] of htmlByUrl) htmlRecord[k] = v
  const inContentKeys = collectInContentInlinkKeys({
    originUrl: origin,
    edges,
    htmlByUrl: htmlRecord,
  })

  for (const page of input.pages) {
    const url = norm(page.url, origin)
    if (url === home) continue
    if (
      isUtilityPage({
        url,
        title: page.title,
        h1: page.h1,
      })
    ) {
      continue
    }
    if (hrefMatchKeys(url, origin).some((k) => inContentKeys.has(k))) continue
    const ins = inbound.get(url) ?? []
    if (ins.length === 0) continue
    let contentIn = 0
    let chromeIn = 0
    for (const e of ins) {
      const html = htmlByUrl.get(e.sourceUrl)
      const region = regionForEdge(html, e.hrefRaw, e.sourceUrl)
      if (region && isInContentInlink(region)) contentIn++
      else if (region && isChromeRegion(region)) chromeIn++
    }
    if (contentIn === 0 && chromeIn > 0) {
      const contentSource = ins.find((e) => !isUtilityPage({ url: e.sourceUrl }))
      if (!contentSource) continue
      const title = titleByUrl.get(url) || pathHint(url)
      push({
        id: `orphan-footer-only|${url}`,
        kind: 'orphan-footer-only',
        sourceUrl: contentSource.sourceUrl,
        targetUrl: url,
        href: hrefOf(url),
        anchorText: title,
        hint: `“${title}” is only linked from the footer or nav. Add a related-reading link from a relevant article so people and search engines can find it in the content.`,
        mechanical: true,
        neverAutoMerge: true,
      })
    }
  }

  return issues.sort((a, b) => a.id.localeCompare(b.id))
}
