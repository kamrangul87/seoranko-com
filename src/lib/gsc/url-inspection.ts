/**
 * Google Search Console URL Inspection API client.
 * Scope: webmasters.readonly (same OAuth as Search Analytics).
 * Endpoint: POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
 */

import { GscApiError } from '@/lib/gsc/client'

const INSPECT_ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'

/** Per-site daily quota (Google hard limit). */
export const GSC_INSPECTION_DAILY_QUOTA = 2000
/** Leave headroom for manual/UI inspections. */
export const GSC_INSPECTION_DAILY_RESERVE = 50
/** Soft per-cron batch cap so Hobby 60s functions finish. */
export const GSC_INSPECTION_BATCH_CAP = 40

export type GscInspectionParsed = {
  verdict: string | null
  coverageState: string | null
  robotsTxtState: string | null
  indexingState: string | null
  googleCanonical: string | null
  userCanonical: string | null
  lastCrawlTime: string | null
  pageFetchState: string | null
  raw: Record<string, unknown>
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

export function parseInspectionResult(body: unknown): GscInspectionParsed {
  const root =
    body && typeof body === 'object'
      ? (body as { inspectionResult?: Record<string, unknown> })
      : {}
  const result = (root.inspectionResult || {}) as Record<string, unknown>
  const indexStatus = (result.indexStatusResult || {}) as Record<string, unknown>

  return {
    verdict: asString(indexStatus.verdict) || asString(result.verdict),
    coverageState: asString(indexStatus.coverageState),
    robotsTxtState: asString(indexStatus.robotsTxtState),
    indexingState: asString(indexStatus.indexingState),
    googleCanonical: asString(indexStatus.googleCanonical),
    userCanonical: asString(indexStatus.userCanonical),
    lastCrawlTime: asString(indexStatus.lastCrawlTime),
    pageFetchState: asString(indexStatus.pageFetchState),
    raw: result && typeof result === 'object' ? result : {},
  }
}

export function computeCanonicalMismatch(
  userCanonical: string | null,
  googleCanonical: string | null,
): boolean {
  if (!userCanonical || !googleCanonical) return false
  try {
    const a = new URL(userCanonical).href.replace(/\/$/, '').toLowerCase()
    const b = new URL(googleCanonical).href.replace(/\/$/, '').toLowerCase()
    return a !== b
  } catch {
    return userCanonical.replace(/\/$/, '').toLowerCase() !== googleCanonical.replace(/\/$/, '').toLowerCase()
  }
}

/**
 * Inspect one URL under a verified Search Console property.
 */
export async function inspectGscUrl(
  accessToken: string,
  opts: { inspectionUrl: string; siteUrl: string; languageCode?: string },
): Promise<GscInspectionParsed> {
  if (!opts.inspectionUrl) throw new Error('inspectionUrl is required')
  if (!opts.siteUrl) throw new Error('siteUrl (Search Console property) is required')

  let attempt = 0
  for (;;) {
    attempt += 1
    const res = await fetch(INSPECT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inspectionUrl: opts.inspectionUrl,
        siteUrl: opts.siteUrl,
        languageCode: opts.languageCode || 'en-US',
      }),
      signal: AbortSignal.timeout(30000),
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
    if (retryable && attempt < 4) {
      await new Promise((r) => setTimeout(r, Math.min(20_000, 800 * 2 ** (attempt - 1))))
      continue
    }
    throw new GscApiError(msg, res.status, retryable)
  }
}

export function remainingInspectionBudget(used: number): number {
  const softCap = GSC_INSPECTION_DAILY_QUOTA - GSC_INSPECTION_DAILY_RESERVE
  return Math.max(0, softCap - used)
}
