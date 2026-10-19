/**
 * Sentinel blob SHA for findings that resolve to a file that must be created
 * (SPA shell serves index.html for the URL — no per-page static file yet).
 * Never matches a real Git blob SHA (40 hex).
 */
export const CREATE_SOURCE_BLOB_SHA = 'create'

export function isCreateSourceBlobSha(sha: string | null | undefined): boolean {
  return sha === CREATE_SOURCE_BLOB_SHA
}

/**
 * Path we would create for a page URL under the preferred static root
 * (e.g. https://autodun.com/privacy → public/privacy/index.html).
 */
export function proposedStaticCreatePath(
  url: string,
  staticRoots: string[],
): string | null {
  try {
    let p = new URL(url).pathname.replace(/^\//, '')
    if (p.endsWith('/')) p = p.slice(0, -1)
    if (!p || p === 'sitemap.xml' || p === 'robots.txt') return null
    if (/\.html?$/i.test(p)) {
      p = p.replace(/\.html?$/i, '')
    }
    if (!p || p.includes('..')) return null
    const root =
      staticRoots.find((r) => r === 'public') ||
      staticRoots.find((r) => r !== '') ||
      'public'
    return `${root}/${p}/index.html`
  } catch {
    return null
  }
}

/** Shell HTML files that SPA rewrites often land on (must not be edited for per-page canonical). */
export const SPA_SHELL_PATHS = ['index.html', 'public/index.html'] as const

/**
 * Minimal static HTML for a page that previously only existed as an SPA route.
 * Self-canonical only — no invented body copy beyond a title derived from the path.
 */
export function buildSelfCanonicalStaticHtml(opts: {
  selfCanonicalUrl: string
  title?: string
}): string {
  const title =
    (opts.title || '').trim() ||
    (() => {
      try {
        const seg = new URL(opts.selfCanonicalUrl).pathname
          .split('/')
          .filter(Boolean)
          .pop()
        return seg
          ? seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          : 'Page'
      } catch {
        return 'Page'
      }
    })()
  const href = opts.selfCanonicalUrl
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="canonical" href="${escapeHtml(href)}">
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></p>
  <footer><a href="/">Home</a> · <a href="/privacy">Privacy</a> · <a href="/contact">Contact</a></footer>
</body>
</html>
`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
