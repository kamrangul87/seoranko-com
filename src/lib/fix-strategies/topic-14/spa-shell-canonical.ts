/**
 * Topic 14 — SPA shell canonical strip.
 *
 * When every SPA route is served via a shared index.html shell that hardcodes
 * homepage canonical + og:url, and per-route canonicals are set client-side
 * (setSEO / Helmet), the safe fix is to remove those tags from the shell only.
 * Never create per-route static HTML stubs (Vercel filesystem beats rewrites).
 *
 * Approval-required — never auto-merge.
 */

export type SpaRouteCanonicalCheck = {
  ok: boolean
  missing: string[]
}

export type SpaShellStripPlan =
  | { action: 'strip-shell'; shellPath: string }
  | { action: 'human-review'; reason: string; missing?: string[] }
  | { action: 'noop'; reason: string }

const CANONICAL_LINK_RE =
  /<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/gi
const CANONICAL_LINK_HREF_FIRST_RE =
  /<link\b[^>]*\bhref\s*=\s*["'][^"']*["'][^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/gi
const OG_URL_RE =
  /<meta\b[^>]*\bproperty\s*=\s*["']og:url["'][^>]*>/gi
const OG_URL_CONTENT_FIRST_RE =
  /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*["'][^>]*\bproperty\s*=\s*["']og:url["'][^>]*>/gi

/** True when source sets a client-side canonical (setSEO / Helmet). */
export function fileSetsClientCanonical(source: string): boolean {
  if (!source.trim()) return false
  // setSEO({ ... canonical: "..." })
  if (
    /\bsetSEO\s*\(\s*\{[\s\S]*?\bcanonical\s*:/m.test(source) ||
    /\bsetSEO\s*\(\s*\{[\s\S]*?\bcanonical\s*:/s.test(source)
  ) {
    return true
  }
  // react-helmet / Helmet: <link rel="canonical" ...> or Helmet({ link: [...] })
  if (
    /<link\b[^>]*\brel\s*=\s*["']canonical["']/i.test(source) ||
    /\brel\s*:\s*["']canonical["']/i.test(source)
  ) {
    return true
  }
  return false
}

export function verifySpaRoutesSetClientCanonical(input: {
  routeFiles: string[]
  readFile: (path: string) => string | null
}): SpaRouteCanonicalCheck {
  const missing: string[] = []
  for (const path of input.routeFiles) {
    const body = input.readFile(path)
    if (body == null || !fileSetsClientCanonical(body)) {
      missing.push(path)
    }
  }
  return { ok: missing.length === 0, missing }
}

/**
 * Remove hardcoded <link rel=canonical> and <meta property=og:url> from the
 * SPA shell. Does not invent replacements — client setSEO owns per-route tags.
 */
export function stripSpaShellCanonicalAndOgUrl(html: string): {
  html: string
  updated: number
} {
  let updated = 0
  let next = html
  for (const re of [
    CANONICAL_LINK_RE,
    CANONICAL_LINK_HREF_FIRST_RE,
    OG_URL_RE,
    OG_URL_CONTENT_FIRST_RE,
  ]) {
    next = next.replace(re, () => {
      updated++
      return ''
    })
  }
  // Collapse leftover blank lines from removals (cosmetic).
  next = next.replace(/\n[ \t]*\n[ \t]*\n/g, '\n\n')
  return { html: next, updated }
}

function urlsEquivalentHomepage(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    const pathA = ua.pathname.replace(/\/+$/, '') || '/'
    const pathB = ub.pathname.replace(/\/+$/, '') || '/'
    return (
      ua.hostname.replace(/^www\./, '') === ub.hostname.replace(/^www\./, '') &&
      pathA === '/' &&
      pathB === '/'
    )
  } catch {
    return false
  }
}

function shellHasHomepageCanonical(html: string, brokenCanonical: string): boolean {
  const hrefs = [
    ...html.matchAll(
      /<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi,
    ),
    ...html.matchAll(
      /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["']/gi,
    ),
  ].map((m) => m[1] || '')
  if (hrefs.length === 0) return false
  return hrefs.some(
    (h) =>
      urlsEquivalentHomepage(h, brokenCanonical) ||
      urlsEquivalentHomepage(h, brokenCanonical.replace(/\/$/, '') + '/') ||
      h.replace(/\/$/, '') === brokenCanonical.replace(/\/$/, ''),
  )
}

/**
 * Decide whether to strip the SPA shell or require human review.
 */
export function planSpaShellCanonicalStrip(input: {
  shellPath: string
  shellHtml: string
  brokenCanonical: string
  routeFiles: string[]
  readFile: (path: string) => string | null
}): SpaShellStripPlan {
  if (!shellHasHomepageCanonical(input.shellHtml, input.brokenCanonical)) {
    return {
      action: 'noop',
      reason: 'Shell does not declare the broken homepage canonical',
    }
  }
  const check = verifySpaRoutesSetClientCanonical({
    routeFiles: input.routeFiles,
    readFile: input.readFile,
  })
  if (!check.ok) {
    return {
      action: 'human-review',
      reason:
        'One or more SPA routes lack a client-side canonical (setSEO/Helmet) — refuse shell strip',
      missing: check.missing,
    }
  }
  return { action: 'strip-shell', shellPath: input.shellPath }
}

/**
 * Discover SPA page modules from a React Router App.tsx (or similar).
 * Skips catch-all (`*`) / NotFound. Optionally skips paths that vercel.json
 * redirects away from the SPA (destination is not /index.html).
 */
export function listSpaRouteFilesFromApp(input: {
  appSource: string
  treePaths: string[]
  vercelJson?: {
    redirects?: Array<{ source?: string; destination?: string }>
  } | null
}): string[] {
  const importMap = new Map<string, string>()
  const importRe =
    /import\s+(\w+)\s+from\s+["']([^"']+)["']/g
  let m: RegExpExecArray | null
  while ((m = importRe.exec(input.appSource)) !== null) {
    importMap.set(m[1]!, m[2]!)
  }

  const redirectedAway = new Set<string>()
  for (const rd of input.vercelJson?.redirects || []) {
    const src = String(rd.source || '').replace(/\/$/, '') || '/'
    const dest = String(rd.destination || '')
    if (!src || src === '/:path*') continue
    // Stay on SPA only when rewrite-like; external / other-path redirects skip.
    if (dest === '/index.html' || dest === 'index.html') continue
    if (dest.startsWith('http') || (dest.startsWith('/') && dest !== src)) {
      redirectedAway.add(src)
    }
  }

  const routeRe =
    /<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["'][^>]*\belement\s*=\s*\{\s*<(\w+)/g
  const routeReAlt =
    /<Route\b[^>]*\belement\s*=\s*\{\s*<(\w+)[^>]*\bpath\s*=\s*["']([^"']+)["']/g

  const symbols = new Set<string>()
  while ((m = routeRe.exec(input.appSource)) !== null) {
    const path = m[1]!
    const sym = m[2]!
    if (path === '*' || /notfound/i.test(sym)) continue
    const norm = path.replace(/\/$/, '') || '/'
    if (redirectedAway.has(norm)) continue
    symbols.add(sym)
  }
  while ((m = routeReAlt.exec(input.appSource)) !== null) {
    const sym = m[1]!
    const path = m[2]!
    if (path === '*' || /notfound/i.test(sym)) continue
    const norm = path.replace(/\/$/, '') || '/'
    if (redirectedAway.has(norm)) continue
    symbols.add(sym)
  }

  const pathSet = new Set(input.treePaths)
  const files: string[] = []
  for (const sym of symbols) {
    const spec = importMap.get(sym)
    if (!spec) continue
    const resolved = resolveImportToTreePath(spec, pathSet)
    if (resolved) files.push(resolved)
  }
  return [...new Set(files)].sort()
}

function resolveImportToTreePath(
  spec: string,
  pathSet: Set<string>,
): string | null {
  let bare = spec.replace(/^@\//, 'src/').replace(/^\.\//, 'src/')
  if (bare.startsWith('../')) return null
  const candidates = [
    bare,
    `${bare}.tsx`,
    `${bare}.jsx`,
    `${bare}.ts`,
    `${bare}.js`,
    `${bare}/index.tsx`,
    `${bare}/index.jsx`,
  ]
  for (const c of candidates) {
    if (pathSet.has(c)) return c
  }
  return null
}

/** Raw HTML must not still ship the homepage canonical / og:url. */
export function verifySpaShellStripLive(input: {
  rawHtml: string
  homepageCanonical: string
}): { ok: boolean; detail: string } {
  const home = input.homepageCanonical.replace(/\/$/, '')
  const homeSlash = `${home}/`
  const hasBadCanonical =
    new RegExp(
      `<link\\b[^>]*rel=["']canonical["'][^>]*href=["']${escapeRe(home)}/?["']`,
      'i',
    ).test(input.rawHtml) ||
    new RegExp(
      `<link\\b[^>]*href=["']${escapeRe(home)}/?["'][^>]*rel=["']canonical["']`,
      'i',
    ).test(input.rawHtml)
  if (hasBadCanonical) {
    return {
      ok: false,
      detail: `raw HTML still has homepage canonical ${home}`,
    }
  }
  const hasBadOg =
    new RegExp(
      `property=["']og:url["'][^>]*content=["']${escapeRe(home)}/?["']`,
      'i',
    ).test(input.rawHtml) ||
    new RegExp(
      `content=["']${escapeRe(home)}/?["'][^>]*property=["']og:url["']`,
      'i',
    ).test(input.rawHtml)
  if (hasBadOg) {
    return {
      ok: false,
      detail: `raw HTML still has homepage og:url ${homeSlash}`,
    }
  }
  // Fail closed if a destructive static stub replaced the SPA route.
  if (
    /<h1>\s*Privacy\s*<\/h1>/i.test(input.rawHtml) &&
    !/id=["']root["']/i.test(input.rawHtml) &&
    input.rawHtml.length < 800
  ) {
    return {
      ok: false,
      detail: 'raw HTML looks like a static privacy stub — SPA route shadowed',
    }
  }
  return { ok: true, detail: 'raw HTML has no homepage canonical/og:url' }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
