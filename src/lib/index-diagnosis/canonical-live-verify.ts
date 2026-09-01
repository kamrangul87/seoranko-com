/**
 * Live canonical verification — re-fetch a URL before surfacing a
 * canonical-misconfiguration finding to any user.
 */

import { isSafePublicUrl } from '@/lib/fetch-page-content'
import {
  canonicalConsolidationOk,
  isIndexHtmlCanonicalMisconfiguration,
} from './canonical-equivalence'

const USER_AGENT = 'SEORANKO-CanonicalVerify/1.0'
const FETCH_TIMEOUT_MS = 8000

export interface CanonicalLiveVerifyResult {
  pageUrl: string
  requestedUrl: string
  finalUrl: string
  liveCanonical: string | null
  /** True only when live HTML still shows an index.html canonical misconfiguration. */
  confirmedMisconfiguration: boolean
  evidence: string
}

function parseCanonicalHref(html: string): string | null {
  const tag = html.match(/<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i)?.[0]
  if (!tag) return null
  return tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || null
}

/**
 * Fresh live fetch of pageUrl — confirms whether an index.html canonical
 * misconfiguration is still present (Cache-Control: no-cache).
 */
export async function verifyCanonicalMisconfigurationLive(
  pageUrl: string,
): Promise<CanonicalLiveVerifyResult> {
  const requestedUrl = pageUrl
  if (!isSafePublicUrl(pageUrl)) {
    return {
      pageUrl,
      requestedUrl,
      finalUrl: pageUrl,
      liveCanonical: null,
      confirmedMisconfiguration: false,
      evidence: 'URL not allowed for live verification',
    }
  }

  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    const html = await res.text()
    const finalUrl = res.url || pageUrl
    const liveCanonical = parseCanonicalHref(html)

    if (!liveCanonical) {
      return {
        pageUrl,
        requestedUrl,
        finalUrl,
        liveCanonical: null,
        confirmedMisconfiguration: false,
        evidence: 'Live fetch: no canonical tag found',
      }
    }

    if (canonicalConsolidationOk(finalUrl, liveCanonical)) {
      return {
        pageUrl,
        requestedUrl,
        finalUrl,
        liveCanonical,
        confirmedMisconfiguration: false,
        evidence: `Live fetch: canonical ${liveCanonical} is valid for page ${finalUrl}`,
      }
    }

    const confirmed = isIndexHtmlCanonicalMisconfiguration(finalUrl, liveCanonical)
    return {
      pageUrl,
      requestedUrl,
      finalUrl,
      liveCanonical,
      confirmedMisconfiguration: confirmed,
      evidence: confirmed
        ? `Live fetch confirmed: canonical ${liveCanonical} does not match page ${finalUrl}`
        : `Live fetch: canonical mismatch on non-index.html URL ${finalUrl} — not flagged as misconfiguration`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed'
    return {
      pageUrl,
      requestedUrl,
      finalUrl: pageUrl,
      liveCanonical: null,
      confirmedMisconfiguration: false,
      evidence: `Live verification skipped: ${msg}`,
    }
  }
}
