// src/lib/logo-reachability.ts
// Field presence ("a logo URL string exists") is not the same as the URL
// actually working — the Clearbit fallback this codebase used to emit
// (https://logo.clearbit.com/<host>) was present in every schema for months
// after the API was permanently shut down (2025-12-08), and nothing ever
// caught it because every check only looked at whether the field existed.
// This does a real HTTP request and only counts a logo as reachable when it
// returns 200 with an image content-type.

export interface LogoReachabilityResult {
  reachable: boolean
  reason: string
}

const TIMEOUT_MS = 8_000

export async function verifyLogoUrlReachable(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LogoReachabilityResult> {
  try {
    // GET, not HEAD: several CDNs (Clearbit included, historically) return
    // 404/405 on HEAD while GET succeeds, or vice versa — GET is the only
    // request method guaranteed to reflect what a browser/crawler actually
    // gets when it loads the image.
    const res = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      return { reachable: false, reason: `HTTP ${res.status} — logo URL does not resolve` }
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('image/')) {
      return {
        reachable: false,
        reason: `HTTP ${res.status} but content-type "${contentType || 'unknown'}" is not an image — logo URL does not serve a usable image`,
      }
    }
    return { reachable: true, reason: `HTTP ${res.status}, content-type ${contentType}` }
  } catch (err) {
    return {
      reachable: false,
      reason: `logo URL unreachable — ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
