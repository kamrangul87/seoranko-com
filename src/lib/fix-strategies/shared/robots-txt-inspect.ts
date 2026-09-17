/**
 * Topic 22 robots.txt inspection — parse result also feeds topic 21.
 *
 * Build once via `inspectRobotsTxt`; topic 21 must reuse that object.
 */

import {
  ROBOTS_TXT_MAX_BYTES,
  parseRobotsTxt,
  isPathAllowed,
  type PathAllowedResult,
} from './robots-txt-matcher'

export type RobotsTxtFetchStatus =
  | 'ok'
  | 'not-found' // 4xx — crawling permitted (R20), not a defect
  | 'server-error' // 5xx / unreachable — assume complete disallow (R21)
  | 'transient-5xx' // not stable across re-fetch → topic 3

export type RobotsSitemapRecord = {
  /** 1-based line number. */
  line: number
  /** Raw value after `Sitemap:`. */
  value: string
  raw: string
}

export type RobotsTxtInspection = {
  url: string
  status: number | null
  fetchStatus: RobotsTxtFetchStatus
  contentType: string | null
  /** True when Content-Type is text/plain (or missing with 200 body). */
  isTextPlain: boolean
  byteLength: number
  exceedsSizeLimit: boolean
  body: string
  /** Truncated body used for matching (≤ 500 KiB). */
  bodyForMatching: string
  groups: ReturnType<typeof parseRobotsTxt>
  /** Line numbers (1-based) of crawl-delay directives. */
  crawlDelayLines: Array<{ line: number; raw: string }>
  /** Unsupported noindex: lines in robots.txt. */
  noindexLines: Array<{ line: number; raw: string }>
  /** Lines that look like rules but failed to parse. */
  malformedLines: Array<{ line: number; raw: string }>
  /**
   * `Sitemap:` records anywhere in the file (S19 — independent of
   * User-agent groups). Topics 24 / 28 read these; do not re-parse.
   */
  sitemapRecords: RobotsSitemapRecord[]
  detail: string
}

export type HopRecordingLikeDeps = {
  fetch: typeof fetch
}

/**
 * Inspect a robots.txt response body (no network). Used after fetch.
 */
export function inspectRobotsTxtBody(
  body: string,
  opts: {
    url: string
    status: number | null
    contentType: string | null
    fetchStatus: RobotsTxtFetchStatus
  },
): RobotsTxtInspection {
  const byteLength = new TextEncoder().encode(body).length
  const exceedsSizeLimit = byteLength > ROBOTS_TXT_MAX_BYTES
  const bodyForMatching =
    body.length > ROBOTS_TXT_MAX_BYTES
      ? body.slice(0, ROBOTS_TXT_MAX_BYTES)
      : body

  const groups = parseRobotsTxt(body)
  const crawlDelayLines: RobotsTxtInspection['crawlDelayLines'] = []
  const noindexLines: RobotsTxtInspection['noindexLines'] = []
  const malformedLines: RobotsTxtInspection['malformedLines'] = []
  const sitemapRecords: RobotsSitemapRecord[] = []

  const lines = body.split(/\r\n|\n|\r/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const stripped = raw.replace(/#.*$/, '').trim()
    if (!stripped) continue
    const colon = stripped.indexOf(':')
    if (colon < 0) {
      // Non-empty line without colon — malformed as a record
      if (/[a-zA-Z]/.test(stripped)) {
        malformedLines.push({ line: i + 1, raw: stripped })
      }
      continue
    }
    const key = stripped.slice(0, colon).trim().toLowerCase()
    const value = stripped.slice(colon + 1).trim()
    if (key === 'crawl-delay') {
      crawlDelayLines.push({ line: i + 1, raw: stripped })
    }
    if (key === 'noindex') {
      noindexLines.push({ line: i + 1, raw: stripped })
    }
    // S19: Sitemap: may appear anywhere; independent of User-agent groups
    if (key === 'sitemap') {
      sitemapRecords.push({ line: i + 1, value, raw: stripped })
    }
  }

  const ct = opts.contentType
  const isTextPlain =
    !ct ||
    /^text\/plain\b/i.test(ct) ||
    /^text\/plain\b/i.test(ct.split(';')[0]!.trim())

  return {
    url: opts.url,
    status: opts.status,
    fetchStatus: opts.fetchStatus,
    contentType: ct,
    isTextPlain:
      opts.status != null && opts.status >= 200 && opts.status < 300
        ? isTextPlain
        : true,
    byteLength,
    exceedsSizeLimit,
    body,
    bodyForMatching,
    groups,
    crawlDelayLines,
    noindexLines,
    malformedLines,
    sitemapRecords,
    detail: summarise(opts.fetchStatus, opts.status),
  }
}

function summarise(fs: RobotsTxtFetchStatus, status: number | null): string {
  if (fs === 'not-found') {
    return `robots.txt ${status ?? 404} — crawling permitted (R20); not a defect`
  }
  if (fs === 'server-error') {
    return `robots.txt ${status ?? 'unreachable'} — assume complete disallow (R21)`
  }
  if (fs === 'transient-5xx') {
    return 'robots.txt transient 5xx — topic 3'
  }
  return 'robots.txt reachable'
}

/**
 * Fetch `/robots.txt` at the origin and inspect once.
 * Topic 21 must reuse the returned object — do not re-fetch/re-parse.
 */
export async function fetchAndInspectRobotsTxt(
  originUrl: string,
  deps: HopRecordingLikeDeps,
  opts?: { confirm5xx?: boolean },
): Promise<RobotsTxtInspection> {
  let origin: URL
  try {
    origin = new URL(originUrl)
  } catch {
    return inspectRobotsTxtBody('', {
      url: originUrl,
      status: null,
      contentType: null,
      fetchStatus: 'server-error',
    })
  }

  const robotsUrl = `${origin.origin}/robots.txt`

  const first = await deps.fetch(robotsUrl, {
    method: 'GET',
    redirect: 'follow',
  })

  if (first.status >= 500) {
    if (opts?.confirm5xx !== false) {
      const second = await deps.fetch(robotsUrl, {
        method: 'GET',
        redirect: 'follow',
      })
      if (second.status < 500) {
        // Recovered — treat as transient
        return inspectRobotsTxtBody('', {
          url: robotsUrl,
          status: first.status,
          contentType: first.headers.get('content-type'),
          fetchStatus: 'transient-5xx',
        })
      }
    }
    return inspectRobotsTxtBody('', {
      url: robotsUrl,
      status: first.status,
      contentType: first.headers.get('content-type'),
      fetchStatus: 'server-error',
    })
  }

  if (first.status >= 400) {
    return inspectRobotsTxtBody('', {
      url: robotsUrl,
      status: first.status,
      contentType: first.headers.get('content-type'),
      fetchStatus: 'not-found',
    })
  }

  const body = await first.text()
  return inspectRobotsTxtBody(body, {
    url: robotsUrl,
    status: first.status,
    contentType: first.headers.get('content-type'),
    fetchStatus: 'ok',
  })
}

/**
 * Path allow check using a prior inspection's matching body (topic 21).
 */
export function isPathAllowedFromInspection(
  inspection: RobotsTxtInspection,
  userAgent: string,
  path: string,
): PathAllowedResult {
  if (inspection.fetchStatus === 'server-error') {
    // R21 — assume complete disallow
    return { allowed: false, matchedRule: 'assumed-complete-disallow (5xx)' }
  }
  if (inspection.fetchStatus === 'not-found') {
    // R20 — crawling permitted
    return { allowed: true, matchedRule: null }
  }
  if (inspection.fetchStatus === 'transient-5xx') {
    return { allowed: true, matchedRule: null }
  }
  return isPathAllowed(inspection.bodyForMatching, userAgent, path)
}
