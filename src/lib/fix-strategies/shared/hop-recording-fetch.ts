/**
 * GET with redirect: 'manual', recording every hop until a non-3xx response,
 * a visited-set loop, max hops, or a 3xx with no Location.
 *
 * Loop detection uses a VISITED SET of normalised URLs (not consecutive
 * comparison), so A → B → A is caught. Normalisation is
 * `normalizeFixStrategyUrl`: relative→absolute, lowercase scheme/host, resolve
 * dot segments. Does NOT collapse trailing slash, path case, query, or port.
 */

import { normalizeFixStrategyUrl } from './url-normalize'

export type RedirectHop = {
  url: string
  status: number
  location: string | null
}

export type HopStoppedReason =
  | 'non-3xx'
  | 'repeat-url'
  | 'max-hops'
  | 'missing-location'

export type HopRecordingResult = {
  hops: RedirectHop[]
  finalUrl: string
  finalStatus: number
  stoppedReason: HopStoppedReason
  /** Body of the final non-3xx response when read; empty on redirect-only stops. */
  finalBody: string
  /** Headers of the final response that produced finalStatus. */
  finalHeaders: Headers
  /**
   * Normalised URL keys in visit order (for loop cycle reporting).
   * Uses the same key the visited-set comparison uses.
   */
  visitedNormalized: string[]
}

export type HopRecordingDeps = {
  fetch: typeof fetch
}

export type HopRecordingOptions = {
  /** Maximum 3xx hops to follow. Default 10 (Googlebot hard limit). */
  maxHops?: number
  /**
   * When true (default), read the final non-3xx body so callers can classify
   * noindex / canonical without a second fetch.
   */
  readFinalBody?: boolean
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400
}

/**
 * Normalise a URL for visited-set membership (topic 5 rules).
 * Returns null if unparseable — caller should not treat as a repeat.
 */
export function normalizeHopUrl(url: string, base?: string): string | null {
  return normalizeFixStrategyUrl(url, base)
}

/**
 * GET a URL with `redirect: 'manual'`, recording every hop's status and
 * Location until a non-3xx response, a repeat URL (loop), missing Location
 * on a 3xx, or maxHops.
 */
export async function recordRedirectHops(
  url: string,
  deps: HopRecordingDeps,
  opts?: HopRecordingOptions,
): Promise<HopRecordingResult> {
  const maxHops = opts?.maxHops ?? 10
  const readFinalBody = opts?.readFinalBody !== false
  const hops: RedirectHop[] = []
  const visited = new Set<string>()
  const visitedNormalized: string[] = []

  let currentUrl = url
  let finalUrl = url
  let finalStatus = 0
  let stoppedReason: HopStoppedReason = 'non-3xx'
  let finalBody = ''
  let finalHeaders = new Headers()

  while (true) {
    const currentKey =
      normalizeHopUrl(currentUrl) ?? currentUrl.toLowerCase()

    if (visited.has(currentKey)) {
      stoppedReason = 'repeat-url'
      finalUrl = currentUrl
      break
    }
    visited.add(currentKey)
    visitedNormalized.push(currentKey)

    const response = await deps.fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
    })

    const rawLocation = response.headers.get('location')
    const location =
      rawLocation !== null && rawLocation !== ''
        ? (() => {
            try {
              return new URL(rawLocation, currentUrl).href
            } catch {
              return null
            }
          })()
        : null

    hops.push({
      url: currentUrl,
      status: response.status,
      location,
    })

    finalUrl = currentUrl
    finalStatus = response.status
    finalHeaders = response.headers

    if (!isRedirectStatus(response.status)) {
      stoppedReason = 'non-3xx'
      if (readFinalBody) {
        try {
          finalBody = await response.text()
        } catch {
          finalBody = ''
        }
      }
      break
    }

    // 3xx with no Location — separate finding (topic 5); chain cannot continue.
    if (location === null) {
      stoppedReason = 'missing-location'
      if (readFinalBody) {
        try {
          finalBody = await response.text()
        } catch {
          finalBody = ''
        }
      }
      break
    }

    // Discard redirect bodies — only Location matters.
    try {
      await response.arrayBuffer()
    } catch {
      // ignore
    }

    const nextKey = normalizeHopUrl(location) ?? location.toLowerCase()
    if (visited.has(nextKey)) {
      // Record the would-be next URL as the cycle close without fetching again.
      stoppedReason = 'repeat-url'
      visitedNormalized.push(nextKey)
      break
    }

    if (hops.filter((h) => isRedirectStatus(h.status)).length >= maxHops) {
      stoppedReason = 'max-hops'
      break
    }

    currentUrl = location
  }

  return {
    hops,
    finalUrl,
    finalStatus,
    stoppedReason,
    finalBody,
    finalHeaders,
    visitedNormalized,
  }
}
