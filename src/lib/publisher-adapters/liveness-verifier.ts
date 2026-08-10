// src/lib/publisher-adapters/liveness-verifier.ts
// Phase B — the generic HTTP verification loop. Provider-agnostic and has
// no platform knowledge at all (no adapter import here, deliberately) —
// it only ever fetches a public URL and inspects the response the way any
// visitor or crawler would. This is the ONLY thing in the whole feature
// allowed to promote LIVE_UNVERIFIED -> LIVE_VERIFIED; a publish() success
// alone never does.

export interface VerificationCheckInput {
  liveUrl: string
  /** A short, distinctive substring expected in the page (e.g. the
   *  article's own <h1> text) — proves the RIGHT content is there, not
   *  just that SOME page responded 200. */
  contentMarker: string
  /** The canonical URL this article's own schema/meta tags claim —
   *  checked against the live page's actual <link rel="canonical">. */
  expectedCanonicalUrl: string
}

export type VerificationVerdict =
  | 'VERIFIED'        // 200, content marker present, canonical matches
  | 'NOT_YET_LIVE'     // transient — 404/5xx/network error/missing marker, keep retrying
  | 'HARD_FAILURE'     // canonical actively wrong, or ceiling exceeded

export interface VerificationResult {
  verdict: VerificationVerdict
  httpStatus?: number
  redirected?: boolean
  finalUrl?: string
  contentMarkerFound?: boolean
  canonicalFound?: string | null
  canonicalMatches?: boolean
  detail: string
}

function extractCanonical(html: string): string | null {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)
  return match?.[1] ?? null
}

function normaliseUrl(url: string): string {
  return url.replace(/\/$/, '').replace(/^https?:\/\//, '').toLowerCase()
}

const FETCH_TIMEOUT_MS = 15000

// Performs ONE fetch-and-check pass — no retry/backoff logic here, that's
// computeBackoff below. Callers loop; this function just answers "what did
// we see this one time."
export async function checkOnce(input: VerificationCheckInput): Promise<VerificationResult> {
  let res: Response
  try {
    res = await fetch(input.liveUrl, {
      headers: { 'User-Agent': 'SEORANKO-Verifier/1.0', 'Cache-Control': 'no-cache' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    return {
      verdict: 'NOT_YET_LIVE',
      detail: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const redirected = res.redirected
  const finalUrl = res.url

  if (!res.ok) {
    return {
      verdict: 'NOT_YET_LIVE',
      httpStatus: res.status,
      redirected,
      finalUrl,
      detail: `HTTP ${res.status} — not live yet (or a genuine error; distinguished from a hard failure only once the retry ceiling is reached).`,
    }
  }

  const html = await res.text()
  const contentMarkerFound = html.includes(input.contentMarker)
  const canonicalFound = extractCanonical(html)
  const canonicalMatches = canonicalFound !== null && normaliseUrl(canonicalFound) === normaliseUrl(input.expectedCanonicalUrl)

  // A canonical that's present but points somewhere ELSE is a real
  // configuration problem, not a timing issue — hard-fail immediately
  // rather than waiting out the retry ceiling for something retrying can't
  // fix.
  if (canonicalFound !== null && !canonicalMatches) {
    return {
      verdict: 'HARD_FAILURE',
      httpStatus: res.status,
      redirected,
      finalUrl,
      contentMarkerFound,
      canonicalFound,
      canonicalMatches: false,
      detail: `Canonical tag present but wrong: found "${canonicalFound}", expected "${input.expectedCanonicalUrl}". This won't fix itself on retry.`,
    }
  }

  if (!contentMarkerFound) {
    return {
      verdict: 'NOT_YET_LIVE',
      httpStatus: res.status,
      redirected,
      finalUrl,
      contentMarkerFound: false,
      canonicalFound,
      canonicalMatches,
      detail: 'Page responded 200 but the expected content marker was not found — could be a caching delay or the wrong page.',
    }
  }

  return {
    verdict: 'VERIFIED',
    httpStatus: res.status,
    redirected,
    finalUrl,
    contentMarkerFound: true,
    canonicalFound,
    canonicalMatches,
    detail: redirected
      ? `Verified, but note: request was redirected to ${finalUrl}.`
      : 'Verified: 200, content marker found, canonical matches.',
  }
}

// Backoff schedule per the phase spec: 30s, 1m, 2m, 5m, 15m, then a fixed
// ceiling step (defaults to 30min) until the overall ceiling is reached.
const BACKOFF_STEPS_SECONDS = [30, 60, 120, 300, 900]
const CEILING_STEP_SECONDS = 1800 // 30min steps once past the named schedule
const DEFAULT_CEILING_SECONDS = 60 * 60 // 60min total before a NOT_YET_LIVE becomes a hard failure

export interface BackoffDecision {
  /** True once cumulative elapsed time has passed the ceiling — a further
   *  NOT_YET_LIVE verdict at this point should be treated as HARD_FAILURE. */
  ceilingExceeded: boolean
  nextDelaySeconds: number
}

export function computeBackoff(attemptNumber: number, elapsedSeconds: number, ceilingSeconds = DEFAULT_CEILING_SECONDS): BackoffDecision {
  if (elapsedSeconds >= ceilingSeconds) {
    return { ceilingExceeded: true, nextDelaySeconds: 0 }
  }
  const delay = attemptNumber < BACKOFF_STEPS_SECONDS.length
    ? BACKOFF_STEPS_SECONDS[attemptNumber]
    : CEILING_STEP_SECONDS
  // Don't schedule a step that would land past the ceiling — clamp so the
  // next check happens right at the ceiling instead of overshooting it.
  const clamped = Math.min(delay, Math.max(1, ceilingSeconds - elapsedSeconds))
  return { ceilingExceeded: false, nextDelaySeconds: clamped }
}
