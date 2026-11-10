import { listCrawlJobsWithHtml, type HtmlCrawlJob } from './persist'

type FallbackJob = {
  url: string
  status: string
  httpStatus: number | null
  finalUrl: string | null
  html: string | null
}

export async function loadHtmlJobsForRun(
  runId: string,
  listFallback: () => Promise<FallbackJob[]>,
): Promise<HtmlCrawlJob[]> {
  const listed = await listCrawlJobsWithHtml(runId)
  if (listed.length > 0) return listed
  const full = await listFallback()
  return full.map((j) => ({
    url: j.url,
    status: j.status,
    httpStatus: j.httpStatus,
    finalUrl: j.finalUrl,
    html: j.html,
  }))
}
