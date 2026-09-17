/**
 * Topic 45 — crawl depth (architecture metric, not a defect).
 *
 * NO depth threshold attributed to Google (N10). Report depth + shortest path.
 * No severity on any depth value. Non-crawlable links do not reduce depth.
 * Orphans → depth undefined (topic 43). client_only → report honestly.
 */

import {
  buildInternalLinkGraph,
  type InternalLinkGraph,
  type BuildLinkGraphOptions,
} from '@/lib/fix-strategies/shared/internal-link-graph'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

export type Topic45Verdict =
  | 'metric-click-depth'
  | 'metric-pagination-pattern'
  | 'route-topic-43-depth-undefined'
  | 'report-client-only-graph'
  | 'suppress-non-crawlable-does-not-reduce-depth'
  | 'ok'

export type Topic45Finding = {
  kind: 'internal-links/crawl-depth'
  verdict: Topic45Verdict
  /** Always null — never attribute severity to a depth value. */
  severity: null
  pageUrl: string
  detail: string
  autoFixable: false
  depth: number | null
  shortestPath: string[] | null
  renderRequired: boolean
  /** Product decision threshold if set — labelled, never attributed to Google. */
  productThreshold: number | null
}

export type DetectTopic45Result = {
  findings: Topic45Finding[]
  metrics: Topic45Finding[]
  suppressed: Array<{ verdict: Topic45Verdict; detail: string }>
  graph: InternalLinkGraph
  /** Depth histogram for architecture reporting. */
  depthDistribution: Record<string, number>
}

export type DetectTopic45Options = {
  graph?: InternalLinkGraph
  build?: BuildLinkGraphOptions
  /** URLs known to be reached only through pagination archives. */
  paginationPatternUrls?: string[]
}

/** Never attribute a numeric depth threshold to Google. */
export function rejectedGoogleDepthThreshold(): never {
  throw new Error(
    'topic 45: Google publishes no click-depth threshold (N10) — never attribute one',
  )
}

/** Never claim depth prevents indexing. */
export function rejectedDepthPreventsIndexing(): never {
  throw new Error(
    'topic 45: never claim depth beyond N clicks prevents or risks de-indexing',
  )
}

export function detectCrawlDepth(
  options: DetectTopic45Options,
): DetectTopic45Result {
  const graph =
    options.graph ??
    buildInternalLinkGraph(
      options.build ?? { originUrl: 'https://example.com', pages: [] },
    )
  const findings: Topic45Finding[] = []
  const metrics: Topic45Finding[] = []
  const suppressed: DetectTopic45Result['suppressed'] = []
  const depthDistribution: Record<string, number> = {}
  const productThreshold =
    FIX_STRATEGY_PRODUCT_DECISIONS.clickDepthReportingThreshold

  if (graph.clientOnlyGraph) {
    findings.push({
      kind: 'internal-links/crawl-depth',
      verdict: 'report-client-only-graph',
      severity: null,
      pageUrl: graph.originUrl,
      detail:
        'Served HTML yields no crawlable link graph (client_only) — depth cannot be measured without false architecture claims',
      autoFixable: false,
      depth: null,
      shortestPath: null,
      renderRequired: false,
      productThreshold,
    })
    return { findings, metrics, suppressed, graph, depthDistribution }
  }

  // Non-crawlable edges never reduce depth — record suppress when present
  if (graph.edges.some((e) => !e.crawlable)) {
    suppressed.push({
      verdict: 'suppress-non-crawlable-does-not-reduce-depth',
      detail:
        'onclick/javascript: links do not reduce click depth (N1, N3)',
    })
  }

  const pagination = new Set(options.paginationPatternUrls ?? [])

  for (const node of graph.nodes) {
    if (node.urlNormalized === graph.homepageNormalized) continue

    if (node.depth == null) {
      findings.push({
        kind: 'internal-links/crawl-depth',
        verdict: 'route-topic-43-depth-undefined',
        severity: null,
        pageUrl: node.urlNormalized,
        detail:
          'Depth undefined (no inbound crawlable path from homepage) — topic 43, not infinite depth',
        autoFixable: false,
        depth: null,
        shortestPath: null,
        renderRequired: false,
        productThreshold,
      })
      continue
    }

    const key = String(node.depth)
    depthDistribution[key] = (depthDistribution[key] ?? 0) + 1

    const pathStr = (node.shortestPath ?? []).join(' → ')
    const baseDetail = `Click depth ${node.depth} from homepage (assumed root ${graph.homepageNormalized}). Shortest path: ${pathStr}. Architecture metric only — not a Google threshold.`

    if (pagination.has(node.urlNormalized)) {
      metrics.push({
        kind: 'internal-links/crawl-depth',
        verdict: 'metric-pagination-pattern',
        severity: null,
        pageUrl: node.urlNormalized,
        detail: `${baseDetail} Reachable via pagination archives — labelled as pagination pattern, not a defect.`,
        autoFixable: false,
        depth: node.depth,
        shortestPath: node.shortestPath,
        renderRequired: node.pathUsedRenderRequired,
        productThreshold,
      })
      continue
    }

    // Always report as metric when depth >= 1; no severity ever
    metrics.push({
      kind: 'internal-links/crawl-depth',
      verdict: 'metric-click-depth',
      severity: null,
      pageUrl: node.urlNormalized,
      detail:
        node.pathUsedRenderRequired
          ? `${baseDetail} Path includes at least one render-required <a href> (N4).`
          : baseDetail,
      autoFixable: false,
      depth: node.depth,
      shortestPath: node.shortestPath,
      renderRequired: node.pathUsedRenderRequired,
      productThreshold,
    })
  }

  return { findings, metrics, suppressed, graph, depthDistribution }
}
