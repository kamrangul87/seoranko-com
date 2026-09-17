/**
 * Topic 43 — orphan pages in the crawlable link graph (detect/report).
 *
 * "Orphaned in the link graph" is provable. "Google cannot discover this page"
 * is NOT. JS-rendered real <a href> is NOT orphaned. onclick/javascript: only
 * IS orphaned. client_only graph → report honestly, no false orphans.
 */

import {
  buildInternalLinkGraph,
  recordNonCrawlableInbound,
  type InternalLinkGraph,
  type BuildLinkGraphOptions,
} from '@/lib/fix-strategies/shared/internal-link-graph'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared/url-normalize'

export type Topic43Verdict =
  | 'finding-link-graph-orphan'
  | 'finding-orphan-in-sitemap-lower'
  | 'finding-orphan-onclick-only'
  | 'human-review-campaign-landing'
  | 'suppress-homepage'
  | 'suppress-non-indexable'
  | 'suppress-js-rendered-inbound'
  | 'report-client-only-graph'
  | 'ok'

export type Topic43Finding = {
  kind: 'internal-links/orphan-pages'
  verdict: Topic43Verdict
  /** Lower when sitemap-listed; null severity never claims undiscoverability. */
  severity: 'high' | 'moderate' | null
  pageUrl: string
  detail: string
  autoFixable: boolean
  inSitemap: boolean
  /** Convert onclick/javascript: → <a href> when that is the only inbound. */
  convertNonCrawlableToAnchor: boolean
}

export type DetectTopic43Result = {
  findings: Topic43Finding[]
  suppressed: Array<{ verdict: Topic43Verdict; detail: string }>
  graph: InternalLinkGraph
}

export type DetectTopic43Options = {
  graph?: InternalLinkGraph
  build?: BuildLinkGraphOptions
  /**
   * Targets reachable only via onclick/javascript: from some page
   * (still orphans in the crawlable graph).
   */
  nonCrawlableInbound?: Array<{
    targetUrl: string
    kind: 'onclick' | 'javascript'
  }>
}

/** Never claim Google cannot discover/index the page. */
export function rejectedUndiscoverabilityClaim(): never {
  throw new Error(
    'topic 43: wording must say link-graph orphan only — never "Google cannot discover"',
  )
}

/** Sitemap listing does not close an orphan finding. */
export function rejectedSitemapAsOrphanFix(): never {
  throw new Error(
    'topic 43: sitemap aids discovery but does not close a link-graph orphan (N9)',
  )
}

export function detectOrphanPages(
  options: DetectTopic43Options,
): DetectTopic43Result {
  const graph =
    options.graph ??
    buildInternalLinkGraph(
      options.build ?? { originUrl: 'https://example.com', pages: [] },
    )
  const findings: Topic43Finding[] = []
  const suppressed: DetectTopic43Result['suppressed'] = []

  for (const nc of options.nonCrawlableInbound ?? []) {
    recordNonCrawlableInbound(graph, nc.targetUrl, nc.kind)
  }

  if (graph.clientOnlyGraph) {
    findings.push({
      kind: 'internal-links/orphan-pages',
      verdict: 'report-client-only-graph',
      severity: null,
      pageUrl: graph.originUrl,
      detail:
        'Served HTML yields no crawlable internal link graph (client_only) — cannot assert orphans without false positives (topic 67)',
      autoFixable: false,
      inSitemap: false,
      convertNonCrawlableToAnchor: false,
    })
    return { findings, suppressed, graph }
  }

  for (const node of graph.nodes) {
    if (node.urlNormalized === graph.homepageNormalized) {
      suppressed.push({
        verdict: 'suppress-homepage',
        detail: `Homepage excluded: ${node.urlNormalized}`,
      })
      continue
    }

    if (
      node.hasNoindex ||
      (node.status != null && node.status !== 200)
    ) {
      suppressed.push({
        verdict: 'suppress-non-indexable',
        detail: `Not an orphan finding — noindex or non-200: ${node.urlNormalized}`,
      })
      continue
    }

    // JS-rendered real <a href> inbound → NOT orphaned
    if (
      node.inboundCrawlableCount > 0 &&
      node.inboundCrawlableCount === node.inboundRenderRequiredCount
    ) {
      suppressed.push({
        verdict: 'suppress-js-rendered-inbound',
        detail: `Reachable via JS-rendered <a href> — not orphaned; rendering was required (N4): ${node.urlNormalized}`,
      })
      continue
    }

    if (node.inboundCrawlableCount > 0) continue

    // Zero crawlable inbound
    if (node.campaignLanding) {
      findings.push({
        kind: 'internal-links/orphan-pages',
        verdict: 'human-review-campaign-landing',
        severity: 'moderate',
        pageUrl: node.urlNormalized,
        detail:
          'Zero inbound crawlable internal links; flagged as campaign/landing — may be intentionally unlinked (human-review). Link-graph orphan only — not a claim Google cannot discover it.',
        autoFixable: false,
        inSitemap: node.inSitemap,
        convertNonCrawlableToAnchor: false,
      })
      continue
    }

    if (node.inboundNonCrawlableCount > 0) {
      findings.push({
        kind: 'internal-links/orphan-pages',
        verdict: 'finding-orphan-onclick-only',
        severity: 'high',
        pageUrl: node.urlNormalized,
        detail:
          'Orphaned in the crawlable link graph — reachable only via onclick/javascript: (N1, N3). Convert to a real <a href>.',
        autoFixable: false,
        inSitemap: node.inSitemap,
        convertNonCrawlableToAnchor: true,
      })
      continue
    }

    if (node.inSitemap) {
      findings.push({
        kind: 'internal-links/orphan-pages',
        verdict: 'finding-orphan-in-sitemap-lower',
        severity: 'moderate',
        pageUrl: node.urlNormalized,
        detail:
          'Orphaned in the link graph but listed in the XML sitemap — discovery is not blocked (N8, N9); sitemap does not close the graph orphan.',
        autoFixable: false,
        inSitemap: true,
        convertNonCrawlableToAnchor: false,
      })
      continue
    }

    findings.push({
      kind: 'internal-links/orphan-pages',
      verdict: 'finding-link-graph-orphan',
      severity: 'high',
      pageUrl: node.urlNormalized,
      detail:
        'Zero inbound crawlable internal links — orphaned in the site link graph. Not a claim that Google cannot discover or index this page (N8).',
      autoFixable: false,
      inSitemap: false,
      convertNonCrawlableToAnchor: false,
    })
  }

  return { findings, suppressed, graph }
}

export function isHomepageUrl(
  url: string,
  homepage: string,
  origin: string,
): boolean {
  const a = normalizeFixStrategyUrl(url, origin)
  const b = normalizeFixStrategyUrl(homepage, origin)
  return a != null && a === b
}
