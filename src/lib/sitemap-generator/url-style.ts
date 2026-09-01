export interface UrlStyle {
  scheme: 'http' | 'https'
  trailingSlash: boolean
}

export interface UrlStyleReport {
  style: UrlStyle
  mixedScheme: boolean
  mixedTrailingSlash: boolean
  normalizedUrls: Map<string, string>
  /** crawledUrl → normalized loc when they differ. */
  styleCorrections: Array<{ crawled: string; normalized: string }>
}

function pathHasTrailingSlash(pathname: string): boolean {
  return pathname.length > 1 && pathname.endsWith('/')
}

export function analyzeAndNormalizeUrls(urls: string[]): UrlStyleReport {
  let https = 0
  let http = 0
  let withSlash = 0
  let withoutSlash = 0

  for (const u of urls) {
    try {
      const parsed = new URL(u)
      if (parsed.protocol === 'https:') https++
      else http++
      if (pathHasTrailingSlash(parsed.pathname)) withSlash++
      else if (parsed.pathname.length > 1) withoutSlash++
    } catch {
      /* skip invalid */
    }
  }

  const style: UrlStyle = {
    scheme: https >= http ? 'https' : 'http',
    trailingSlash: withSlash > withoutSlash,
  }

  const mixedScheme = https > 0 && http > 0
  const mixedTrailingSlash = withSlash > 0 && withoutSlash > 0

  const normalizedUrls = new Map<string, string>()
  const styleCorrections: Array<{ crawled: string; normalized: string }> = []

  for (const crawled of urls) {
    try {
      const u = new URL(crawled)
      u.protocol = `${style.scheme}:`
      if (u.pathname.length > 1) {
        if (style.trailingSlash && !u.pathname.endsWith('/')) u.pathname += '/'
        else if (!style.trailingSlash && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
      }
      const normalized = u.href
      normalizedUrls.set(crawled, normalized)
      if (normalized !== crawled) styleCorrections.push({ crawled, normalized })
    } catch {
      normalizedUrls.set(crawled, crawled)
    }
  }

  return { style, mixedScheme, mixedTrailingSlash, normalizedUrls, styleCorrections }
}
