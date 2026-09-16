/**
 * Topic 21 — robots.txt blocking render-critical CSS/JS.
 *
 * Requires a prior RobotsTxtInspection from topic 22 (parse once).
 * Three conditions: disallowed for Googlebot, referenced by indexable page,
 * same-origin. Report only — never auto-unblock. Materiality not asserted.
 */

import { parseHtml } from '@/lib/fix-strategies/shared'
import {
  isPathAllowedFromInspection,
  type RobotsTxtInspection,
} from '@/lib/fix-strategies/shared/robots-txt-inspect'
import {
  extractPageRobotsDirectives,
} from '@/lib/fix-strategies/shared/robots-directives'

export type Topic21Verdict =
  | 'report-blocked-resource'
  | 'suppress-cross-origin'
  | 'suppress-non-indexable-referrer'
  | 'suppress-allowed-by-allow-rule'
  | 'suppress-non-googlebot-ua'
  | 'suppress-analytics'
  | 'suppress-no-robots-inspection'

export type Topic21Finding = {
  kind: 'robots/blocking-css-js'
  verdict: Topic21Verdict
  resourceUrl: string
  matchedRule: string | null
  referencedBy: string[]
  detail: string
  /** Materiality is reported, never asserted. */
  materialityAsserted: false
}

export type DetectTopic21Page = {
  url: string
  html: string
  headers?: Headers
  contentType?: string | null
  /** Page returns 200 and is not blocked by robots.txt. */
  indexable: boolean
}

export type DetectTopic21Result = {
  findings: Topic21Finding[]
  suppressed: Array<{
    resourceUrl: string
    verdict: Topic21Verdict
    detail: string
  }>
}

const ANALYTICS_RE =
  /(google-analytics|googletagmanager|gtag\/js|facebook\.net|hotjar|segment\.com|clarity\.ms|\/analytics\.js\b|\/gtm\.js\b)/i

function collectSameOriginAssets(
  html: string,
  pageUrl: string,
): Array<{ url: string; path: string; kind: 'css' | 'js' }> {
  const parsed = parseHtml(html)
  const origin = new URL(pageUrl).origin
  const out: Array<{ url: string; path: string; kind: 'css' | 'js' }> = []

  for (const link of [
    ...parsed.headElements('link'),
    ...parsed.bodyElements('link'),
  ]) {
    const rel = (link.attrs.rel ?? '').toLowerCase()
    if (!rel.split(/\s+/).includes('stylesheet')) continue
    const href = link.attrs.href?.trim()
    if (!href) continue
    try {
      const abs = new URL(href, pageUrl)
      if (abs.origin !== origin) {
        out.push({ url: abs.href, path: abs.pathname, kind: 'css' })
        // mark cross-origin via path starting with special? we'll filter later
        continue
      }
      out.push({ url: abs.href, path: abs.pathname + abs.search, kind: 'css' })
    } catch {
      // skip
    }
  }

  for (const script of [
    ...parsed.headElements('script'),
    ...parsed.bodyElements('script'),
  ]) {
    const src = script.attrs.src?.trim()
    if (!src) continue
    try {
      const abs = new URL(src, pageUrl)
      out.push({
        url: abs.href,
        path: abs.origin === origin ? abs.pathname + abs.search : abs.href,
        kind: 'js',
      })
    } catch {
      // skip
    }
  }

  return out
}

export function detectBlockedRenderResources(
  pages: DetectTopic21Page[],
  inspection: RobotsTxtInspection | null,
  opts?: { userAgent?: string },
): DetectTopic21Result {
  const findings: Topic21Finding[] = []
  const suppressed: DetectTopic21Result['suppressed'] = []
  const ua = opts?.userAgent ?? 'Googlebot'

  if (!inspection || inspection.fetchStatus === 'transient-5xx') {
    suppressed.push({
      resourceUrl: '',
      verdict: 'suppress-no-robots-inspection',
      detail: 'No usable robots.txt inspection from topic 22',
    })
    return { findings, suppressed }
  }

  // Aggregate: resource → referencing indexable pages
  const byResource = new Map<
    string,
    { path: string; referrers: string[]; crossOrigin: boolean }
  >()

  for (const page of pages) {
    const assets = collectSameOriginAssets(page.html, page.url)
    const origin = new URL(page.url).origin

    for (const asset of assets) {
      let abs: URL
      try {
        abs = new URL(asset.url)
      } catch {
        continue
      }
      const crossOrigin = abs.origin !== origin
      const existing = byResource.get(asset.url)
      if (!existing) {
        byResource.set(asset.url, {
          path: crossOrigin ? abs.pathname : asset.path,
          referrers: page.indexable ? [page.url] : [],
          crossOrigin,
        })
      } else if (page.indexable) {
        existing.referrers.push(page.url)
      }
    }
  }

  for (const [resourceUrl, info] of byResource) {
    if (info.crossOrigin) {
      suppressed.push({
        resourceUrl,
        verdict: 'suppress-cross-origin',
        detail: 'Cross-origin — site robots.txt does not govern it (guard 1)',
      })
      continue
    }

    if (ANALYTICS_RE.test(resourceUrl)) {
      suppressed.push({
        resourceUrl,
        verdict: 'suppress-analytics',
        detail: 'Analytics/ads/tracking — blocking does not affect content understanding (guard 6)',
      })
      continue
    }

    if (info.referrers.length === 0) {
      suppressed.push({
        resourceUrl,
        verdict: 'suppress-non-indexable-referrer',
        detail: 'Referenced only by non-indexable pages (guard 2)',
      })
      continue
    }

    // Also verify referrers aren't noindex in their HTML
    const indexableReferrers = info.referrers.filter((ref) => {
      const page = pages.find((p) => p.url === ref)
      if (!page?.indexable) return false
      const dirs = extractPageRobotsDirectives(
        page.headers ?? new Headers(),
        page.html,
        page.contentType ?? 'text/html',
      )
      return !dirs.hasNoindex
    })

    if (indexableReferrers.length === 0) {
      suppressed.push({
        resourceUrl,
        verdict: 'suppress-non-indexable-referrer',
        detail: 'Referrers carry noindex — not a Search rendering problem',
      })
      continue
    }

    const path = info.path.startsWith('/') ? info.path : `/${info.path}`
    const allowed = isPathAllowedFromInspection(inspection, ua, path)

    if (allowed.allowed) {
      suppressed.push({
        resourceUrl,
        verdict: 'suppress-allowed-by-allow-rule',
        detail: allowed.matchedRule
          ? `Allowed by ${allowed.matchedRule} (R17)`
          : 'No matching Disallow — allowed (R18)',
      })
      continue
    }

    findings.push({
      kind: 'robots/blocking-css-js',
      verdict: 'report-blocked-resource',
      resourceUrl,
      matchedRule: allowed.matchedRule,
      referencedBy: indexableReferrers,
      detail: `Disallowed for ${ua} by ${allowed.matchedRule}; referenced by ${indexableReferrers.length} indexable page(s). Materiality not asserted.`,
      materialityAsserted: false,
    })
  }

  return { findings, suppressed }
}
