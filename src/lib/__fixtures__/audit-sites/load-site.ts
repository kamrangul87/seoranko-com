/**
 * Load static HTML fixture sites into FetchedPage / LinkGraph shapes.
 * No network — fixtures are the source of truth for regression.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FetchedPage } from '@/lib/index-diagnosis/crawler'
import type { CrawlCoverage, PageIndexability } from '@/lib/index-diagnosis/types'
import type { LinkGraphInput } from '@/lib/link-graph/types'
import type { SitemapCrawlInput } from '@/lib/sitemap-generator/types'
import type { FixtureManifest, FixturePageDef } from './types'

const FIXTURES_ROOT = join(__dirname)

function parseCanonicalTags(html: string): string[] {
  const matches = Array.from(html.matchAll(/<link[^>]+rel=["']canonical["'][^>]*>/gi))
  const urls: string[] = []
  for (const tag of matches) {
    const href = tag[0].match(/href=["']([^"']+)["']/i)?.[1]?.trim()
    if (href) urls.push(href)
  }
  return urls
}

function parseMetaRobots(html: string): string {
  const m =
    html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']robots["']/i)
  return m?.[1]?.trim() || ''
}

function parseHead(html: string): { pageTitle: string; pageH1: string } {
  const pageTitle =
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || ''
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const pageH1 = h1Match?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || ''
  return { pageTitle, pageH1 }
}

export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).href
}

export function loadFixtureHtml(fixtureId: string, file: string): string {
  const path = join(FIXTURES_ROOT, fixtureId, 'pages', file)
  if (!existsSync(path)) {
    throw new Error(`Fixture HTML missing: ${fixtureId}/pages/${file}`)
  }
  return readFileSync(path, 'utf8')
}

export function pageDefToFetched(
  manifest: FixtureManifest,
  def: FixturePageDef,
): FetchedPage | null {
  if (def.excludeAsNon200) return null
  const url = absoluteUrl(manifest.origin, def.path)
  const html = loadFixtureHtml(manifest.id, def.file)
  const canon = parseCanonicalTags(html)
  const head = parseHead(html)
  return {
    url,
    finalUrl: url,
    httpStatus: def.httpStatus ?? 200,
    html,
    depth: def.depth,
    redirectCount: 0,
    xRobotsTag: '',
    metaRobots: parseMetaRobots(html),
    canonicalUrl: canon[0] || '',
    canonicalTags: canon,
    pageTitle: head.pageTitle,
    pageH1: head.pageH1,
    fetchError: null,
    timedOut: false,
  }
}

export function loadFetchedPages(manifest: FixtureManifest): FetchedPage[] {
  return manifest.pages
    .map((p) => pageDefToFetched(manifest, p))
    .filter((p): p is FetchedPage => p != null)
}

export function buildFixtureCoverage(
  manifest: FixtureManifest,
  fetchedCount: number,
): CrawlCoverage {
  const excluded = manifest.pages
    .filter((p) => p.excludeAsNon200)
    .map((p) => ({
      url: absoluteUrl(manifest.origin, p.path),
      reason: 'NON_200' as const,
      evidence: `HTTP ${p.httpStatus ?? 404}`,
      httpStatus: p.httpStatus ?? 404,
    }))

  const discoveredCount = manifest.pages.length
  const domain = new URL(manifest.origin).hostname

  return {
    domain,
    seedUrl: absoluteUrl(manifest.origin, manifest.seedPath),
    discoveredCount,
    fetchedCount,
    excluded,
    excludedByReason: {
      ROBOTS_DISALLOWED: 0,
      META_NOINDEX: 0,
      X_ROBOTS_NOINDEX: 0,
      NON_200: excluded.length,
      DEPTH_LIMIT: 0,
      TIMEOUT: 0,
      PLAN_LIMIT: 0,
      REDIRECT_CHAIN: 0,
      NOT_REACHED: 0,
    },
    terminationReason: 'QUEUE_EMPTY',
    terminationEvidence: 'fixture crawl complete',
    discoverySources: { sitemap: manifest.sitemapPaths.length, links: fetchedCount, both: 0, seed: 1 },
    sitemapOnlyUrls: [],
    linkedOnlyUrls: [],
    sitemapDiscoveredUrls: manifest.sitemapPaths.map((p) => absoluteUrl(manifest.origin, p)),
    robotsTxtFetched: true,
    robotsTxtEvidence: 'fixture robots.txt',
  }
}

export function buildSitemapInput(
  manifest: FixtureManifest,
  pages: PageIndexability[],
  htmlByUrl: Record<string, string>,
): SitemapCrawlInput {
  const fetched = loadFetchedPages(manifest)
  return {
    domain: new URL(manifest.origin).hostname,
    seedUrl: absoluteUrl(manifest.origin, manifest.seedPath),
    pages,
    coverage: buildFixtureCoverage(manifest, fetched.length),
    htmlByUrl,
    robotsTxt: manifest.robotsTxt,
    ranAt: new Date().toISOString(),
    crawlSource: 'fresh',
  }
}

export function buildLinkGraphInput(
  manifest: FixtureManifest,
  pages: PageIndexability[],
  htmlByUrl: Record<string, string>,
): LinkGraphInput {
  return {
    seedUrl: absoluteUrl(manifest.origin, manifest.seedPath),
    siteHost: new URL(manifest.origin).hostname,
    htmlByUrl,
    pages: pages.map((p) => ({
      url: p.url,
      httpStatus: p.httpStatus,
      crawlDepth: p.crawlDepth,
      verdict: p.verdict,
      steps: p.steps.map((s) => ({ step: s.step, passed: s.passed, evidence: s.evidence })),
    })),
    sitemapUrls: manifest.sitemapPaths.map((p) => absoluteUrl(manifest.origin, p)),
    robotsTxt: manifest.robotsTxt,
  }
}

export function htmlByUrlFromFetched(pages: FetchedPage[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of pages) out[p.finalUrl] = p.html
  return out
}
