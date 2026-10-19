/**
 * Topic 43 — add an orphan page link into a shared nav/footer HTML snippet.
 * Inserts next to an existing <a href> in footer/nav. Never invents copy:
 * uses the page title / last path segment as anchor text.
 */

const FOOTER_OR_NAV =
  /<(footer|nav)\b[^>]*>[\s\S]*?<\/\1>/i

export function pickAnchorText(opts: {
  pageTitle?: string | null
  pageUrl: string
}): string {
  const t = (opts.pageTitle || '').replace(/\s+/g, ' ').trim()
  if (t && t.length <= 80) return t
  try {
    const path = new URL(opts.pageUrl).pathname.replace(/\/+$/, '')
    const seg = path.split('/').filter(Boolean).pop() || 'page'
    return seg.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '')
  } catch {
    return 'page'
  }
}

/**
 * Insert `<a href="{href}">{anchor}</a>` immediately after the last existing
 * anchor inside the first <footer> or <nav>. Falls back to appending before
 * </body> when no footer/nav exists.
 */
export function addNavOrFooterLink(
  html: string,
  opts: { href: string; anchorText: string },
): { html: string; updated: number; target: 'footer-nav' | 'body-fallback' } {
  const href = opts.href
  const text = opts.anchorText.replace(/</g, '').trim() || 'page'
  const link = `<a href="${href}">${text}</a>`

  const blockMatch = html.match(FOOTER_OR_NAV)
  if (blockMatch && blockMatch.index != null) {
    const block = blockMatch[0]
    const lastA = block.lastIndexOf('</a>')
    if (lastA >= 0) {
      const patchedBlock =
        block.slice(0, lastA + 4) + ` ${link}` + block.slice(lastA + 4)
      const next =
        html.slice(0, blockMatch.index) +
        patchedBlock +
        html.slice(blockMatch.index + block.length)
      if (next.includes(`href="${href}"`)) {
        return { html: next, updated: 1, target: 'footer-nav' }
      }
    }
  }

  if (/<\/body>/i.test(html)) {
    return {
      html: html.replace(/<\/body>/i, `  <nav aria-label="Site">${link}</nav>\n</body>`),
      updated: 1,
      target: 'body-fallback',
    }
  }

  return { html: `${html}\n${link}\n`, updated: 1, target: 'body-fallback' }
}
