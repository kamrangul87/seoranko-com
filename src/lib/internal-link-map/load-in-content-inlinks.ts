/**
 * Latest-crawl in-content inlink keys for re-evaluating footer-only findings.
 */

import { loadHtmlJobsForRun } from './load-html-jobs'
import { listCrawlLinkEdges } from './persist'
import { LINK_MAP_MAX_PAGES, rebuildMissingCrawlLinkEdges } from './rebuild-edges'
import { collectInContentInlinkKeys } from './link-health'

export async function loadInContentInlinkKeysForRun(input: {
  runId: string
  origin: string
  siteId: string
  userId: string
  listJobsForRun: () => Promise<
    Array<{
      url: string
      status: string
      httpStatus: number | null
      finalUrl: string | null
      html: string | null
    }>
  >
}): Promise<Set<string>> {
  try {
    const htmlJobs = await loadHtmlJobsForRun(input.runId, input.listJobsForRun)
    let edges = await listCrawlLinkEdges(input.runId)
    if (edges.length === 0 && htmlJobs.length > 0) {
      const rebuilt = await rebuildMissingCrawlLinkEdges({
        runId: input.runId,
        siteId: input.siteId,
        userId: input.userId,
        origin: input.origin,
        existingEdges: edges,
        jobs: htmlJobs,
      })
      edges = rebuilt.edges
    }
    const htmlByUrl: Record<string, string> = {}
    for (const job of htmlJobs.slice(0, LINK_MAP_MAX_PAGES)) {
      if (!job.html) continue
      htmlByUrl[job.finalUrl || job.url] = job.html
      htmlByUrl[job.url] = job.html
    }
    return collectInContentInlinkKeys({
      originUrl: input.origin,
      edges,
      htmlByUrl,
    })
  } catch {
    return new Set()
  }
}
