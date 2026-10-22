/**
 * Hard rule: a Fix Agent transform must NEVER create a new file at a path that
 * would serve (or shadow) an existing live route. Fail closed.
 */

export type LiveRouteCreateContext = {
  createPath: string
  pageUrl: string
  treePaths: string[]
  /** Parsed vercel.json (rewrites / routes) when present in the repo. */
  vercelJson: {
    rewrites?: Array<{ source?: string; destination?: string }>
    routes?: Array<{ src?: string; dest?: string; handle?: string }>
  } | null
  /** Live HTTP status for pageUrl (HEAD/GET). */
  liveStatus: number
  /** Snippet of live body (enough to detect real content vs empty/404). */
  liveBodySnippet: string
}

export type LiveRouteCreateGuardResult =
  | { allowed: true }
  | { allowed: false; reason: string }

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/'
  } catch {
    return null
  }
}

function pathMatchesRewriteSource(pathname: string, source: string): boolean {
  // Exact or simple :path* patterns — enough for /privacy and /:path* SPA fallbacks.
  if (source === pathname || source === `${pathname}/`) return true
  if (source === '/:path*' || source === '/(.*)' || source === '/:path(.*)') {
    return true
  }
  // "/privacy" exact from vercel.json
  const lit = source.replace(/\/$/, '')
  return lit === pathname
}

/** Framework page modules that already own this URL. */
export function frameworkRoutePathsForUrl(
  pageUrl: string,
  treePaths: string[],
): string[] {
  const pathname = pathnameOf(pageUrl)
  if (!pathname || pathname === '/') return []
  const seg = pathname.replace(/^\//, '')
  if (!seg || seg.includes('..')) return []
  const candidates = [
    `src/pages/${seg}.tsx`,
    `src/pages/${seg}.jsx`,
    `src/pages/${titleCaseFile(seg)}.tsx`,
    `src/pages/${titleCaseFile(seg)}.jsx`,
    `pages/${seg}.tsx`,
    `pages/${seg}.jsx`,
    `app/${seg}/page.tsx`,
    `app/${seg}/page.jsx`,
    `src/app/${seg}/page.tsx`,
    `src/app/${seg}/page.jsx`,
  ]
  const set = new Set(treePaths)
  return candidates.filter((p) => set.has(p))
}

function titleCaseFile(seg: string): string {
  return seg
    .split(/[-_/]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join('')
}

function liveLooksLikeRealPage(status: number, body: string): boolean {
  if (status < 200 || status >= 400) return false
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  // Fail closed: any substantial HTML body counts as an existing page.
  return text.length >= 40 || /<(article|main|h1)\b/i.test(body)
}

/**
 * Return whether creating `createPath` for `pageUrl` is safe.
 * Default deny whenever any signal says the route already exists.
 */
export function assertSafeToCreateFileAtLiveRoute(
  input: LiveRouteCreateContext,
): LiveRouteCreateGuardResult {
  const pathname = pathnameOf(input.pageUrl)
  if (!pathname) {
    return { allowed: false, reason: 'Invalid page URL — refuse create' }
  }

  const rewrites = input.vercelJson?.rewrites || []
  for (const rw of rewrites) {
    const src = String(rw.source || '')
    if (!src) continue
    if (pathMatchesRewriteSource(pathname, src)) {
      return {
        allowed: false,
        reason: `vercel.json rewrite maps ${pathname} → ${rw.destination || 'SPA shell'} — creating ${input.createPath} would replace the live route`,
      }
    }
  }

  // Catch-all SPA fallback routes in vercel.json
  const routes = input.vercelJson?.routes || []
  for (const rt of routes) {
    if (rt.handle === 'filesystem') continue
    const src = String(rt.src || '')
    if (src && pathMatchesRewriteSource(pathname, src)) {
      return {
        allowed: false,
        reason: `vercel.json route maps ${pathname} to SPA fallback — refuse create at ${input.createPath}`,
      }
    }
  }

  const framework = frameworkRoutePathsForUrl(input.pageUrl, input.treePaths)
  if (framework.length > 0) {
    return {
      allowed: false,
      reason: `Framework route already exists (${framework[0]}) — refuse create at ${input.createPath}`,
    }
  }

  if (liveLooksLikeRealPage(input.liveStatus, input.liveBodySnippet)) {
    return {
      allowed: false,
      reason: `Live URL returns HTTP ${input.liveStatus} with real content — refuse create at ${input.createPath} (would shadow the existing page)`,
    }
  }

  // Still fail closed if create path is under public/ for a path that has ANY
  // same-segment source file we missed.
  const seg = pathname.replace(/^\//, '')
  const loose = input.treePaths.filter(
    (p) =>
      /(^|\/)pages?\//i.test(p) &&
      new RegExp(`${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(p),
  )
  if (loose.length > 0) {
    return {
      allowed: false,
      reason: `Possible framework/page owner for ${pathname} (${loose[0]}) — refuse create`,
    }
  }

  return { allowed: true }
}
