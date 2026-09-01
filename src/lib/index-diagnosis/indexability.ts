import { normalizeUrl } from '@/lib/supabase/audit-db'
import { matchRobotsForUrl } from './robots-parser'
import {
  clusterNearDuplicates,
  contentFingerprintHash,
  extractMainContentText,
} from './content-fingerprint'
import type { FetchedPage } from './crawler'
import type {
  CanonicalKind,
  IndexabilityStep,
  IndexabilityVerdict,
  InboundLinkEvidence,
  PageIndexability,
} from './types'

function classifyCanonical(
  pageUrl: string,
  canonicalTags: string[],
): { kind: CanonicalKind; evidence: string } {
  if (canonicalTags.length === 0) {
    return { kind: 'missing', evidence: 'No <link rel="canonical"> tag found' }
  }
  if (canonicalTags.length > 1) {
    const uniq = new Set(canonicalTags)
    if (uniq.size > 1) {
      return {
        kind: 'conflicting',
        evidence: `Multiple conflicting canonical hrefs: ${canonicalTags.join(' | ')}`,
      }
    }
  }

  const canon = canonicalTags[0]!
  let canonHost = ''
  let pageHost = ''
  try {
    canonHost = new URL(canon).hostname.replace(/^www\./, '')
    pageHost = new URL(pageUrl).hostname.replace(/^www\./, '')
  } catch {
    return { kind: 'other', evidence: `Canonical href not parseable: ${canon}` }
  }

  const normCanon = normalizeUrl(canon)
  const normPage = normalizeUrl(pageUrl)

  if (canonHost !== pageHost.replace(/^www\./, '')) {
    return {
      kind: 'cross-domain',
      evidence: `Canonical ${canon} points off-site (page host ${pageHost})`,
    }
  }
  if (normCanon === normPage || canon === pageUrl) {
    return { kind: 'self', evidence: `Canonical self-reference: ${canon}` }
  }
  return { kind: 'other', evidence: `Canonical points to different same-host URL: ${canon} (page ${pageUrl})` }
}

export function pathPatternForUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    if (parts.length === 0) return '/'
    const shaped = parts.map((seg) => {
      if (/^\d+$/.test(seg)) return ':id'
      if (/^[0-9a-f-]{36}$/i.test(seg)) return ':uuid'
      if (seg.length > 24) return ':slug'
      if (/\.(html?|php|aspx)$/i.test(seg)) return seg.replace(/^[^.]+/, ':slug')
      return seg
    })
    return `/${shaped.join('/')}`
  } catch {
    return '/'
  }
}

export function depthBand(depth: number): string {
  if (depth <= 0) return '0-home'
  if (depth === 1) return '1'
  if (depth === 2) return '2'
  return '3+'
}

function buildInboundMap(pages: FetchedPage[]): Map<string, InboundLinkEvidence[]> {
  const map = new Map<string, InboundLinkEvidence[]>()
  const hostNorm = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }

  for (const page of pages) {
    const links = Array.from(page.html.matchAll(/href=["']([^"'#?]+)["']/gi))
    for (const m of links) {
      let abs = m[1].trim()
      try {
        if (abs.startsWith('/')) abs = new URL(abs, page.finalUrl).href
        if (!abs.startsWith('http')) continue
        if (hostNorm(abs) !== hostNorm(page.finalUrl)) continue
        const target = normalizeUrl(abs)
        const list = map.get(target) || []
        if (!list.some((x) => x.fromUrl === page.finalUrl)) {
          list.push({ fromUrl: page.finalUrl, fromDepth: page.depth })
        }
        map.set(target, list)
      } catch {
        /* skip */
      }
    }
  }
  return map
}

export function evaluatePageIndexability(
  page: FetchedPage,
  robotsTxt: string,
  inbound: InboundLinkEvidence[],
  duplicateClusterId: string | null,
  duplicateClusterSize: number,
  mainText: string,
): PageIndexability {
  const steps: IndexabilityStep[] = []

  steps.push({
    step: 'http_status',
    passed: page.httpStatus >= 200 && page.httpStatus < 300,
    evidence: `HTTP ${page.httpStatus} at ${page.finalUrl}`,
  })

  const robots = matchRobotsForUrl(robotsTxt, page.url)
  steps.push({
    step: 'robots_txt',
    passed: robots.allowed,
    evidence: robots.evidence,
  })

  const metaNoindex = /noindex/i.test(page.metaRobots)
  steps.push({
    step: 'meta_robots',
    passed: !metaNoindex,
    evidence: page.metaRobots
      ? `<meta name="robots" content="${page.metaRobots}">`
      : 'No meta robots tag',
  })

  const xNoindex = /noindex/i.test(page.xRobotsTag)
  steps.push({
    step: 'x_robots',
    passed: !xNoindex,
    evidence: page.xRobotsTag ? `X-Robots-Tag: ${page.xRobotsTag}` : 'No X-Robots-Tag header',
  })

  const canon = classifyCanonical(page.finalUrl, page.canonicalTags)
  const canonOk = canon.kind === 'self' || canon.kind === 'missing'
  steps.push({
    step: 'canonical',
    passed: canonOk,
    evidence: canon.evidence,
  })

  steps.push({
    step: 'crawl_depth',
    passed: page.depth <= 3,
    evidence: `Crawl depth ${page.depth} from seed`,
  })

  const linksIn = inbound.length
  steps.push({
    step: 'internal_links_in',
    passed: linksIn >= 1 || page.depth === 0,
    evidence:
      linksIn === 0
        ? '0 internal links point to this URL in crawled pages'
        : `${linksIn} internal link(s) in: ${inbound.map((i) => `${i.fromUrl} (depth ${i.fromDepth})`).join('; ')}`,
  })

  steps.push({
    step: 'duplicate_cluster',
    passed: duplicateClusterSize < 3,
    evidence:
      duplicateClusterSize >= 2
        ? `Near-duplicate cluster ${duplicateClusterId} size ${duplicateClusterSize} (Jaccard >= threshold)`
        : 'Not in a near-duplicate cluster (size < 2)',
  })

  let verdict: IndexabilityVerdict = 'INDEXABLE'
  let decisiveStep: IndexabilityStep['step'] | null = null
  let decisiveEvidence = 'All indexability checks passed'

  const blockingSteps: IndexabilityStep['step'][] = [
    'http_status',
    'robots_txt',
    'meta_robots',
    'x_robots',
  ]

  for (const step of steps) {
    if (blockingSteps.includes(step.step) && !step.passed) {
      verdict = 'BLOCKED'
      decisiveStep = step.step
      decisiveEvidence = step.evidence
      break
    }
  }

  if (verdict === 'INDEXABLE') {
    const riskSteps = steps.filter(
      (s) =>
        !s.passed &&
        (s.step === 'canonical' || s.step === 'internal_links_in' || s.step === 'duplicate_cluster' || s.step === 'crawl_depth'),
    )
    if (riskSteps.length > 0) {
      verdict = 'AT_RISK'
      decisiveStep = riskSteps[0]!.step
      decisiveEvidence = riskSteps[0]!.evidence
    }
  }

  return {
    url: page.finalUrl,
    verdict,
    decisiveStep,
    decisiveEvidence,
    steps,
    httpStatus: page.httpStatus,
    crawlDepth: page.depth,
    internalLinksIn: linksIn,
    inboundLinks: inbound,
    duplicateClusterId,
    duplicateClusterSize,
    mainContentFingerprint: contentFingerprintHash(mainText),
    pathPattern: pathPatternForUrl(page.finalUrl),
    depthBand: depthBand(page.depth),
  }
}

export function evaluateAllPages(
  pages: FetchedPage[],
  robotsTxt: string,
): PageIndexability[] {
  const inboundMap = buildInboundMap(pages)
  const mainTexts = pages.map((p) => ({
    url: p.finalUrl,
    mainText: extractMainContentText(p.html),
  }))
  const clusters = clusterNearDuplicates(mainTexts)

  return pages.map((page) => {
    const cluster = clusters.get(page.finalUrl)
    return evaluatePageIndexability(
      page,
      robotsTxt,
      inboundMap.get(page.finalUrl) || [],
      cluster?.clusterId ?? null,
      cluster?.memberUrls.length ?? 1,
      extractMainContentText(page.html),
    )
  })
}
