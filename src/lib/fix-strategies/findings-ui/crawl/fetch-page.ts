/**
 * Per-URL fetch for the findings crawl: topic 67 stream completion +
 * topic 68 re-fetch evidence + crawler self-rate-limit (topic 3 guard 5).
 */

import { fetchWithEvidence } from '@/lib/fix-strategies/fetch/evidence'
import type { EvidenceResult, FetchDeps, FetchOutcome } from '@/lib/fix-strategies/fetch/types'
import { presenceAfterServedHtml } from '@/lib/fix-strategies/fetch/content-presence'
import { CRAWL_INTER_REQUEST_GAP_MS } from './constants'

export type CrawledPage = {
  requestedUrl: string
  finalUrl: string
  status: number | null
  html: string
  headers: Headers
  streamComplete: boolean
  clientOnly: boolean
  stable: boolean
  crawlerCausedBackoff: boolean
  evidence: EvidenceResult
  errorDetail: string | null
}

function makeDeps(gapMs: number): FetchDeps {
  let lastAt = 0
  return {
    fetch: globalThis.fetch.bind(globalThis),
    now: () => Date.now(),
    sleep: async (ms: number) => {
      const since = Date.now() - lastAt
      const wait = Math.max(ms, gapMs - since, 0)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastAt = Date.now()
    },
  }
}

function httpBody(outcome: FetchOutcome): {
  status: number | null
  html: string
  headers: Headers
  streamComplete: boolean
  finalUrl: string
} {
  if (outcome.kind !== 'http') {
    return {
      status: null,
      html: '',
      headers: new Headers(),
      streamComplete: false,
      finalUrl: '',
    }
  }
  return {
    status: outcome.status,
    html: outcome.body ?? '',
    headers: outcome.headers,
    streamComplete: outcome.streamComplete,
    finalUrl: outcome.url,
  }
}

/** Heuristic: served HTML has almost no text → client_only (topic 67). */
function looksClientOnly(html: string): boolean {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = text.split(' ').filter(Boolean).length
  if (words >= 20) return false
  return presenceAfterServedHtml(false) === 'client_only'
}

/**
 * Fetch one URL with evidence. On 429/5xx attributed to our crawl, back off
 * and mark crawlerCausedBackoff — never raise as a site finding.
 */
export async function crawlOneUrl(
  url: string,
  opts?: { gapMs?: number },
): Promise<CrawledPage> {
  const gapMs = opts?.gapMs ?? CRAWL_INTER_REQUEST_GAP_MS
  const deps = makeDeps(gapMs)
  const evidence = await fetchWithEvidence(url, deps)
  const last = evidence.attempts[evidence.attempts.length - 1]!
  const body = httpBody(last)

  const isBackoffStatus =
    last.kind === 'http' &&
    (last.status === 429 ||
      last.status === 503 ||
      last.statusClass === '5xx-other')

  const crawlerCausedBackoff = Boolean(isBackoffStatus)

  if (crawlerCausedBackoff) {
    await deps.sleep(Math.max(gapMs * 4, 2000))
  }

  const streamIncomplete =
    last.kind === 'http' && last.statusClass === '2xx' && !last.streamComplete

  const clientOnly =
    !streamIncomplete &&
    last.kind === 'http' &&
    last.statusClass === '2xx' &&
    Boolean(body.html) &&
    looksClientOnly(body.html)

  return {
    requestedUrl: url,
    finalUrl: body.finalUrl || url,
    status: body.status,
    html: streamIncomplete ? '' : body.html,
    headers: body.headers,
    streamComplete: body.streamComplete,
    clientOnly,
    stable: evidence.stable,
    crawlerCausedBackoff,
    evidence,
    errorDetail: streamIncomplete
      ? 'stream_incomplete'
      : last.kind !== 'http'
        ? last.kind
        : crawlerCausedBackoff
          ? `crawler_backoff_${body.status}`
          : null,
  }
}
