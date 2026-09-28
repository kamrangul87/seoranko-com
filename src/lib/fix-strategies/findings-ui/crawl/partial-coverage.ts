/**
 * Owner-facing summary of why a crawl is partial.
 * Prefer concrete per-URL reasons (404, stream incomplete, …) over
 * "15 of 19 crawled".
 */

/** Loose note shape — API/UI may not carry the full CoverageNote union. */
export type PartialCoverageNote = {
  code: string
  detail: string
  url?: string
}

export type PartialCoverageBucket = {
  code: string
  label: string
  urls: string[]
  details: string[]
}

export type PartialCoverageSummary = {
  headline: string
  buckets: PartialCoverageBucket[]
  /** True when partial is only (or primarily) the plan page cap. */
  isPlanLimit: boolean
  planLimitDetail: string | null
}

const LABEL: Record<string, string> = {
  fetch_failure: 'Fetch failed',
  client_only: 'Client-only / no usable HTML',
  crawler_backoff: 'Crawler backoff (429/5xx from our crawl)',
  stream_incomplete: 'Incomplete response stream',
  render_failed: 'Headless render failed',
  plan_page_limit: 'Plan page limit',
  discovery_cap: 'Discovery / enqueue cap',
  time_limit: 'Tick time budget',
}

/**
 * Collapse coverage notes into buckets the Findings UI can render.
 * Ignores informational expand/rendered noise.
 */
export function summarizePartialCoverage(
  notes: PartialCoverageNote[],
  opts?: {
    urlsFound?: number
    urlsCrawled?: number
    urlsFailed?: number
    urlsClientOnly?: number
  },
): PartialCoverageSummary {
  const plan = notes.find((n) => n.code === 'plan_page_limit')
  const skipCodes = new Set(['link_graph_expand', 'rendered', 'render_deferred'])

  const byCode = new Map<string, PartialCoverageBucket>()
  for (const n of notes) {
    if (skipCodes.has(n.code)) continue
    if (n.code === 'plan_page_limit') continue
    const cur = byCode.get(n.code) ?? {
      code: n.code,
      label: LABEL[n.code] ?? n.code,
      urls: [],
      details: [],
    }
    if (n.url && !cur.urls.includes(n.url)) cur.urls.push(n.url)
    if (n.detail && !cur.details.includes(n.detail)) cur.details.push(n.detail)
    byCode.set(n.code, cur)
  }

  const buckets = Array.from(byCode.values()).sort((a, b) =>
    a.code.localeCompare(b.code),
  )

  const failed = opts?.urlsFailed ?? 0
  const clientOnly = opts?.urlsClientOnly ?? 0
  const found = opts?.urlsFound ?? 0
  const crawled = opts?.urlsCrawled ?? 0

  let headline: string
  if (plan) {
    headline =
      plan.detail.includes('pages crawled')
        ? plan.detail
        : `${crawled} of ${found} pages crawled — plan limit`
  } else if (failed > 0 && failed + crawled === found && clientOnly === 0) {
    headline = `${crawled} of ${found} pages crawled — ${failed} fetch failure${failed === 1 ? '' : 's'}`
  } else if (buckets.length === 1) {
    const b = buckets[0]!
    headline =
      b.urls.length > 0
        ? `${crawled} of ${found} pages crawled — ${b.label.toLowerCase()} on ${b.urls.length} URL${b.urls.length === 1 ? '' : 's'}`
        : `${crawled} of ${found} pages crawled — ${b.label.toLowerCase()}`
  } else {
    headline = `${crawled} of ${found} pages crawled — partial coverage`
  }

  return {
    headline,
    buckets,
    isPlanLimit: Boolean(plan) && buckets.length === 0,
    planLimitDetail: plan?.detail ?? null,
  }
}
