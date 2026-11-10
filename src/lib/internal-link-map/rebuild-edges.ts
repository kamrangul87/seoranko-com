/**
 * Rebuild crawl link edges from stored job HTML when a run saved 0 rows.
 * Used after crawls that finished before persistEdgesFromHtml was live.
 */

import { extractCrawlLinkEdges } from './extract-edges'
import {
  appendCrawlLinkEdges,
  listCrawlJobsWithHtml,
  listCrawlLinkEdges,
} from './persist'
import type { CrawlLinkEdge } from './types'

export const LINK_MAP_MAX_PAGES = 2000

export type StoredHtmlJob = {
  url: string
  html: string | null | undefined
  finalUrl?: string | null
}

export function edgesFromStoredHtmlJobs(
  jobs: StoredHtmlJob[],
  origin: string,
): CrawlLinkEdge[] {
  const out: CrawlLinkEdge[] = []
  const seen = new Set<string>()
  for (const job of jobs) {
    const html = job.html ?? ''
    if (!html) continue
    const pageUrl = job.finalUrl || job.url
    for (const e of extractCrawlLinkEdges(html, pageUrl, origin)) {
      const k = `${e.sourceUrl}\0${e.targetUrl}\0${e.hrefRaw}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(e)
    }
  }
  return out
}

export async function rebuildMissingCrawlLinkEdges(input: {
  runId: string
  siteId: string | null
  userId: string
  origin: string
  existingEdges: CrawlLinkEdge[]
  jobs?: StoredHtmlJob[]
  maxPages?: number
  deadlineMs?: number
}): Promise<{
  edges: CrawlLinkEdge[]
  rebuilt: boolean
  pagesRead: number
}> {
  if (input.existingEdges.length > 0) {
    return { edges: input.existingEdges, rebuilt: false, pagesRead: 0 }
  }
  const maxPages = Math.min(input.maxPages ?? LINK_MAP_MAX_PAGES, LINK_MAP_MAX_PAGES)
  const jobs =
    input.jobs ??
    (await listCrawlJobsWithHtml(input.runId, {
      max: maxPages,
      deadlineMs: input.deadlineMs,
    }))
  const sliced = jobs.slice(0, maxPages)
  const extracted = edgesFromStoredHtmlJobs(sliced, input.origin)
  if (extracted.length === 0) {
    return { edges: [], rebuilt: false, pagesRead: sliced.length }
  }
  try {
    await appendCrawlLinkEdges({
      runId: input.runId,
      siteId: input.siteId,
      userId: input.userId,
      edges: extracted,
    })
  } catch (err) {
    console.warn(
      '[internal-link-map] rebuild persist failed',
      err instanceof Error ? err.message : err,
    )
  }
  let listed: CrawlLinkEdge[] = []
  try {
    listed = await listCrawlLinkEdges(input.runId)
  } catch (err) {
    console.warn(
      '[internal-link-map] rebuild list failed',
      err instanceof Error ? err.message : err,
    )
  }
  return {
    edges: listed.length > 0 ? listed : extracted,
    rebuilt: true,
    pagesRead: sliced.length,
  }
}
