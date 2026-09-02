/**
 * Link Graph Audit pipeline S1–S9 over Index Diagnosis crawl data.
 * Spec: docs/seoranko-link-graph-spec.md
 */

import { detectJsSuspectedPages, extractAllEdges } from './extract-anchors'
import { enrichTargets } from './enrich-targets'
import { normalizeLinkUrl, detectTrailingSlashConvention, registrableHost } from './normalize'
import { resolveTargets, type TargetFetcher } from './resolve-targets'
import { runAllRules } from './rules'
import { buildTopCauses, buildVerdictHeadline, rankFindings } from './score'
import type { LinkGraphInput, LinkGraphResult, LinkTarget } from './types'

const MAX_EXTERNAL_RESOLVE = 500

export interface RunLinkGraphOptions {
  fetcher?: TargetFetcher
  /** Skip live resolution — use crawl HTTP status only (unit tests / offline). */
  offlineFromCrawl?: boolean
  resolveExternal?: boolean
}

function offlineTargetsFromCrawl(
  urls: string[],
  input: LinkGraphInput,
): Array<
  Omit<
    LinkTarget,
    'canonicalTarget' | 'isIndexable' | 'robotsDisallowed' | 'inSitemap' | 'inlinkCount' | 'depth'
  >
> {
  const pageByUrl = new Map(input.pages.map((p) => [normalizeLinkUrl(p.url) || p.url, p]))
  return urls.map((url) => {
    const page = pageByUrl.get(url)
    return {
      urlNormalized: url,
      finalStatus: page?.httpStatus ?? 200,
      redirectHops: 0,
      redirectChain: [],
      finalUrl: url,
      isRedirectLoop: false,
    }
  })
}

export async function runLinkGraphAudit(
  input: LinkGraphInput,
  opts: RunLinkGraphOptions = {},
): Promise<LinkGraphResult> {
  const siteHost = input.siteHost || registrableHost(input.seedUrl)

  // Detect trailing-slash convention from self-canonical evidence
  const selfCanonicals: string[] = []
  for (const p of input.pages) {
    const step = p.steps.find((s) => s.step === 'canonical')
    if (step?.passed && step.evidence.includes('self-reference')) {
      const m = step.evidence.match(/Canonical self-reference: (.+)$/)
      if (m) selfCanonicals.push(m[1]!)
    }
  }
  const trailingSlashConvention = detectTrailingSlashConvention(
    selfCanonicals,
    input.pages.map((p) => p.url),
  )
  const normalizeOpts = { trailingSlash: trailingSlashConvention }

  // S2 extract anchors
  const edges = extractAllEdges(input.htmlByUrl, siteHost, normalizeOpts)

  // L00 JS suspected
  const jsSuspectedUrls = detectJsSuspectedPages(
    input.htmlByUrl,
    edges,
    input.pages,
    siteHost,
  )
  const jsSuspected = jsSuspectedUrls.length > 0

  // S3 distinct targets
  const internalTargets = Array.from(
    new Set(
      edges
        .filter((e) => e.isInternal)
        .map((e) => e.hrefResolved)
        .filter((u) => u.startsWith('http')),
    ),
  )

  const sitemapNorm = input.sitemapUrls
    .map((u) => normalizeLinkUrl(u, normalizeOpts) || u)
    .filter(Boolean)

  const externalCandidates = Array.from(
    new Set(
      edges
        .filter((e) => !e.isInternal && e.hrefResolved.startsWith('http'))
        .map((e) => e.hrefResolved),
    ),
  )
  const externalSample =
    opts.resolveExternal === false
      ? []
      : externalCandidates.slice(0, MAX_EXTERNAL_RESOLVE)

  const toResolve = Array.from(
    new Set([...internalTargets, ...sitemapNorm, ...externalSample]),
  )

  // S4 resolve
  let resolved
  if (opts.offlineFromCrawl) {
    resolved = offlineTargetsFromCrawl(toResolve, input)
  } else if (opts.fetcher) {
    resolved = await resolveTargets(toResolve, { fetcher: opts.fetcher })
  } else {
    resolved = await resolveTargets(toResolve)
  }

  // S5–S6 enrich + inlinks
  const targets = enrichTargets(resolved, edges, { ...input, siteHost }, trailingSlashConvention)

  const targetByUrl = new Map<string, LinkTarget>()
  for (const t of targets) {
    targetByUrl.set(t.urlNormalized, t)
    if (t.finalUrl !== t.urlNormalized) targetByUrl.set(t.finalUrl, t)
  }

  // S7 rules
  const findings = runAllRules({
    edges,
    targets,
    targetByUrl,
    seedUrl: input.seedUrl,
    siteHost,
    sitemapUrls: sitemapNorm,
    trailingSlashConvention,
    jsSuspected,
    jsSuspectedUrls,
    lang: input.lang,
    pages: input.pages,
  })

  // S8 rank
  const rankedFindings = rankFindings(findings)
  const topCauses = buildTopCauses(findings)
  const verdictHeadline = buildVerdictHeadline(findings)

  return {
    edges,
    targets,
    findings,
    rankedFindings,
    trailingSlashConvention,
    jsSuspected,
    jsSuspectedUrls,
    verdictHeadline,
    topCauses,
    ranAt: new Date().toISOString(),
  }
}
