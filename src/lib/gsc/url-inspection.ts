/**
 * Google Search Console URL Inspection API client.
 * Scope: webmasters.readonly (same OAuth as Search Analytics).
 * Endpoint: POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
 *
 * Canonical normalization (spec):
 * - lowercase scheme + hostname only
 * - strip fragments
 * - normalize default ports (omit :80 / :443)
 * - preserve path and query case
 * - do NOT assume trailing-slash equivalence
 */

import { GscApiError } from '@/lib/gsc/client'

const INSPECT_ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'

/** Per-property Google hard limit. */
export const GSC_INSPECTION_DAILY_QUOTA = 2000
/** Soft cap leaves headroom for manual/UI inspections. */
export const GSC_INSPECTION_DAILY_RESERVE = 50
export const GSC_INSPECTION_SOFT_CAP = GSC_INSPECTION_DAILY_QUOTA - GSC_INSPECTION_DAILY_RESERVE
/** Soft per-invocation batch so Hobby 60s functions finish. */
export const GSC_INSPECTION_BATCH_CAP = 40
/** Stop before Hobby maxDuration (60s) — leave ~8s for DB flush. */
export const GSC_INSPECTION_DEADLINE_MS = 50_000

export type GscInspectionParsed = {
  verdict: string | null
  coverageState: string | null
  robotsTxtState: string | null
  indexingState: string | null
  googleCanonical: string | null
  userCanonical: string | null
  lastCrawlTime: string | null
  pageFetchState: string | null
  crawledAs: string | null
  sitemap: string[]
  referringUrls: string[]
  referringUrlsExhaustive: boolean
  richResultsVerdict: string | null
  richResultsEvidence: Record<string, unknown>
  raw: Record<string, unknown>
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}

/**
 * Normalize a URL for canonical comparison / dedupe keys.
 * Scheme+host lowercased; path/query case preserved; fragment stripped;
 * default ports removed; trailing slash NOT collapsed.
 */
export function normalizeInspectionCanonical(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    u.protocol = u.protocol.toLowerCase() as `${string}:`
    if (
      (u.protocol === 'https:' && (u.port === '443' || u.port === '')) ||
      (u.protocol === 'http:' && (u.port === '80' || u.port === ''))
    ) {
      u.port = ''
    }
    // URL.href may re-encode; rebuild to keep path/query casing from pathname+search.
    const path = u.pathname || '/'
    const search = u.search || ''
    const host = u.host // hostname + non-default port
    return `${u.protocol}//${host}${path}${search}`
  } catch {
    return null
  }
}

export function computeCanonicalMismatch(
  userCanonical: string | null,
  googleCanonical: string | null,
): boolean {
  const a = normalizeInspectionCanonical(userCanonical)
  const b = normalizeInspectionCanonical(googleCanonical)
  if (!a || !b) return false
  return a !== b
}

export function parseInspectionResult(body: unknown): GscInspectionParsed {
  const root =
    body && typeof body === 'object'
      ? (body as { inspectionResult?: Record<string, unknown> })
      : {}
  const result = (root.inspectionResult || {}) as Record<string, unknown>
  const indexStatus = (result.indexStatusResult || {}) as Record<string, unknown>
  const rich = (result.richResultsResult || {}) as Record<string, unknown>

  const referring = asStringArray(indexStatus.referringUrls)
  // Google may omit or truncate referring URLs — never treat as exhaustive proof.
  const referringUrlsExhaustive = false

  return {
    verdict: asString(indexStatus.verdict) || asString(result.verdict),
    coverageState: asString(indexStatus.coverageState),
    robotsTxtState: asString(indexStatus.robotsTxtState),
    indexingState: asString(indexStatus.indexingState),
    googleCanonical: asString(indexStatus.googleCanonical),
    userCanonical: asString(indexStatus.userCanonical),
    lastCrawlTime: asString(indexStatus.lastCrawlTime),
    pageFetchState: asString(indexStatus.pageFetchState),
    crawledAs: asString(indexStatus.crawledAs),
    sitemap: asStringArray(indexStatus.sitemap),
    referringUrls: referring,
    referringUrlsExhaustive,
    richResultsVerdict: asString(rich.verdict),
    richResultsEvidence: rich && typeof rich === 'object' ? rich : {},
    raw: result && typeof result === 'object' ? result : {},
  }
}

/**
 * Inspect one URL. No long retry loops — caller defers on 429/5xx/timeout.
 * languageCode is optional; never silently default to a locale.
 */
export async function inspectGscUrl(
  accessToken: string,
  opts: { inspectionUrl: string; siteUrl: string; languageCode?: string },
): Promise<GscInspectionParsed> {
  if (!opts.inspectionUrl) throw new Error('inspectionUrl is required')
  if (!opts.siteUrl) throw new Error('siteUrl (Search Console property) is required')

  const payload: Record<string, string> = {
    inspectionUrl: opts.inspectionUrl,
    siteUrl: opts.siteUrl,
  }
  if (opts.languageCode) payload.languageCode = opts.languageCode

  const res = await fetch(INSPECT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok) return parseInspectionResult(data)

  const msg =
    typeof data === 'object' &&
    data &&
    'error' in data &&
    typeof (data as { error?: { message?: string } }).error?.message === 'string'
      ? (data as { error: { message: string } }).error.message
      : `URL Inspection API error (${res.status})`

  const retryable = res.status === 429 || res.status === 500 || res.status === 503
  throw new GscApiError(msg, res.status, retryable)
}

export function remainingInspectionBudget(used: number): number {
  return Math.max(0, GSC_INSPECTION_SOFT_CAP - used)
}
