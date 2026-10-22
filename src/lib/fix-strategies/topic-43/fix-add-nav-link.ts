/**
 * Topic 43 — add an orphan page link into a shared nav/footer HTML snippet.
 * Inserts next to an existing <a href> in footer/nav. Never invents copy:
 * uses the page title / last path segment as anchor text.
 */

const FOOTER_OR_NAV =
  /<(footer|nav)\b[^>]*>[\s\S]*?<\/\1>/i

function titleCaseWords(s: string): string {
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/\.\w+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function pickAnchorText(opts: {
  pageTitle?: string | null
  pageUrl: string
  /**
   * When true (default for footer siblings like "Privacy"), prefer a short
   * Title-Case path segment over a long page title ("Contact us" → "Contact").
   */
  preferPathSegment?: boolean
}): string {
  try {
    const path = new URL(opts.pageUrl).pathname.replace(/\/+$/, '')
    const seg = path.split('/').filter(Boolean).pop() || 'page'
    const fromPath = titleCaseWords(seg) || 'Page'
    if (opts.preferPathSegment !== false) {
      // Single-segment orphans: match sibling casing ("Privacy", "Contact").
      if (!seg.includes('-') && !seg.includes('_') && fromPath.length <= 24) {
        return fromPath
      }
    }
    const t = (opts.pageTitle || '').replace(/\s+/g, ' ').trim()
    if (t && t.length <= 80) return t
    return fromPath
  } catch {
    const t = (opts.pageTitle || '').replace(/\s+/g, ' ').trim()
    return t && t.length <= 80 ? t : 'Page'
  }
}

/** Detect the separator used between existing footer/nav anchors (e.g. " · "). */
export function detectNavLinkSeparator(block: string): string {
  const between = block.match(/<\/a>([^<]{0,12})<a\b/i)
  if (between && between[1] != null) {
    const sep = between[1]
    // Prefer explicit middle-dot / bullet separators; else keep as-is if non-empty.
    if (/[·•|]/.test(sep) || sep.includes(' · ')) return sep
    if (sep.trim() === '·') return ' · '
    if (sep.length > 0 && sep.length <= 8) return sep
  }
  if (block.includes(' · ')) return ' · '
  return ' '
}

/**
 * Insert `<a href="{href}">{anchor}</a>` immediately after the last existing
 * anchor inside the first <footer> or <nav>. Falls back to appending before
 * </body> when no footer/nav exists.
 *
 * React Footer components that already use `path: "/…"` / `to="…"` arrays are
 * patched by inserting a new entry next to an existing internal link object.
 */
export function addNavOrFooterLink(
  html: string,
  opts: { href: string; anchorText: string },
): {
  html: string
  updated: number
  target: 'footer-nav' | 'react-nav' | 'body-fallback'
} {
  const href = opts.href
  const text = opts.anchorText.replace(/</g, '').trim() || 'page'
  const link = `<a href="${href}">${text}</a>`

  // Already present (HTML or React Router).
  if (
    html.includes(`href="${href}"`) ||
    html.includes(`href='${href}'`) ||
    html.includes(`path: "${href}"`) ||
    html.includes(`path: '${href}'`) ||
    html.includes(`to="${href}"`) ||
    html.includes(`to='${href}'`)
  ) {
    return { html, updated: 0, target: 'footer-nav' }
  }

  // React: internalLinks / similar arrays of { path, label } (skip href: arrays).
  const reactRe =
    /const\s+(\w*[Ll]inks?)\s*=\s*\[([\s\S]*?)\]\s*;/g
  let reactMatch: RegExpExecArray | null
  while ((reactMatch = reactRe.exec(html)) !== null) {
    const body = reactMatch[2] || ''
    if (!/path\s*:/.test(body)) continue
    const entry = `\n    { path: "${href}", label: ${JSON.stringify(text)} },`
    const next =
      html.slice(0, reactMatch.index) +
      `const ${reactMatch[1]} = [${body}${entry}];` +
      html.slice(reactMatch.index + reactMatch[0].length)
    return { html: next, updated: 1, target: 'react-nav' }
  }

  const blockMatch = html.match(FOOTER_OR_NAV)
  if (blockMatch && blockMatch.index != null) {
    const block = blockMatch[0]
    const lastA = block.lastIndexOf('</a>')
    if (lastA >= 0) {
      const sep = detectNavLinkSeparator(block)
      const patchedBlock =
        block.slice(0, lastA + 4) + `${sep}${link}` + block.slice(lastA + 4)
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
