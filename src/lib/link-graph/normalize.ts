/**
 * Shared URL normalization for the link graph.
 * Spec §3.3 — one function for sitemap URLs, crawled URLs, and hrefs.
 */

const TRACKING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'ref',
  '_ga',
])

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase()
  if (TRACKING_PARAMS.has(lower)) return true
  if (lower.startsWith('utm_')) return true
  return false
}

export interface NormalizeLinkUrlOptions {
  /** Site trailing-slash convention (majority of self-canonicals). */
  trailingSlash?: boolean
  /** Base URL for resolving relative hrefs. */
  baseUrl?: string
}

/**
 * Normalize a URL for link-graph comparison.
 * Relative hrefs require baseUrl.
 */
export function normalizeLinkUrl(
  raw: string,
  opts: NormalizeLinkUrlOptions = {},
): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('javascript:') ||
    trimmed === '#' ||
    trimmed.toLowerCase().startsWith('javascript:void')
  ) {
    return null
  }

  let absolute: string
  try {
    if (opts.baseUrl) {
      absolute = new URL(trimmed, opts.baseUrl).href
    } else if (/^https?:\/\//i.test(trimmed)) {
      absolute = trimmed
    } else {
      return null
    }
  } catch {
    return null
  }

  try {
    const u = new URL(absolute)
    u.hash = ''
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase()
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = ''
    }

    const kept = Array.from(u.searchParams.entries())
      .filter(([k]) => !isTrackingParam(k))
      .sort(([a], [b]) => a.localeCompare(b))
    u.search = ''
    for (const [k, v] of kept) u.searchParams.append(k, v)

    let path = u.pathname || '/'
    // Percent-decode unreserved characters only (safe decode of path segments)
    try {
      path = path
        .split('/')
        .map((seg) => {
          try {
            const decoded = decodeURIComponent(seg)
            // Re-encode if decode introduced spaces/unsafe — keep simple alphanumeric
            return encodeURIComponent(decoded)
              .replace(/%2F/gi, '/')
              .replace(/%2D/gi, '-')
              .replace(/%2E/gi, '.')
              .replace(/%5F/gi, '_')
              .replace(/%7E/gi, '~')
              .replace(/%20/g, '%20')
          } catch {
            return seg
          }
        })
        .join('/')
    } catch {
      /* keep path */
    }

    if (opts.trailingSlash != null && path.length > 1) {
      const looksLikeFile = /\.[a-z0-9]{1,8}$/i.test(path.split('/').pop() || '')
      if (!looksLikeFile) {
        if (opts.trailingSlash && !path.endsWith('/')) path += '/'
        if (!opts.trailingSlash && path.endsWith('/')) path = path.slice(0, -1)
      }
    }

    u.pathname = path || '/'
    // Drop trailing ? with empty search
    const href = u.href.replace(/\?$/, '')
    return href
  } catch {
    return null
  }
}

/** Host without www for same-site checks. */
export function registrableHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export function isSameSite(url: string, siteHost: string): boolean {
  const h = registrableHost(url)
  const site = siteHost.replace(/^www\./, '').toLowerCase()
  return h === site || h.endsWith(`.${site}`)
}

/**
 * Detect trailing-slash convention from self-referencing canonicals.
 * Falls back to majority among provided page URLs.
 */
export function detectTrailingSlashConvention(
  selfCanonicals: string[],
  fallbackUrls: string[] = [],
): boolean {
  const pool = selfCanonicals.length > 0 ? selfCanonicals : fallbackUrls
  let withSlash = 0
  let without = 0
  for (const raw of pool) {
    try {
      const path = new URL(raw).pathname
      if (path.length <= 1) continue
      if (/\.[a-z0-9]{1,8}$/i.test(path)) continue
      if (path.endsWith('/')) withSlash++
      else without++
    } catch {
      /* skip */
    }
  }
  if (withSlash === 0 && without === 0) return false
  return withSlash > without
}
