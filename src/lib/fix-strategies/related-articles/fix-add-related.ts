/**
 * Deterministic "Related articles" block for blog pages with no in-content
 * internal links. Links 3 sibling pages from the same folder; anchors are
 * their titles/h1 — never model-generated prose.
 */

export type RelatedTarget = {
  href: string
  anchorText: string
}

const RELATED_MARKER = 'data-seoranko-related-articles'

export function buildRelatedArticlesHtml(targets: RelatedTarget[]): string {
  const items = targets
    .slice(0, 3)
    .map(
      (t) =>
        `<li><a href="${t.href}">${t.anchorText.replace(/</g, '').trim() || 'Article'}</a></li>`,
    )
    .join('')
  return `<aside ${RELATED_MARKER}="1"><h2>Related articles</h2><ul>${items}</ul></aside>`
}

/**
 * Append Related articles before </main> or </article> or </body>.
 * No-op when the marker is already present.
 */
export function addRelatedArticlesBlock(
  html: string,
  targets: RelatedTarget[],
): { html: string; updated: number } {
  if (targets.length === 0) return { html, updated: 0 }
  if (html.includes(RELATED_MARKER)) return { html, updated: 0 }
  const block = buildRelatedArticlesHtml(targets)
  if (/<\/article>/i.test(html)) {
    return {
      html: html.replace(/<\/article>/i, `${block}</article>`),
      updated: 1,
    }
  }
  if (/<\/main>/i.test(html)) {
    return { html: html.replace(/<\/main>/i, `${block}</main>`), updated: 1 }
  }
  if (/<\/body>/i.test(html)) {
    return { html: html.replace(/<\/body>/i, `${block}</body>`), updated: 1 }
  }
  return { html: `${html}\n${block}\n`, updated: 1 }
}

/** Same-folder siblings: share path dirname, exclude self. */
export function pickRelatedSiblingUrls(
  pageUrl: string,
  candidates: Array<{ url: string; title?: string | null; h1?: string | null }>,
  limit = 3,
): RelatedTarget[] {
  let dir: string
  try {
    const u = new URL(pageUrl)
    const parts = u.pathname.replace(/\/+$/, '').split('/')
    parts.pop()
    dir = parts.join('/') || '/'
  } catch {
    return []
  }

  const out: RelatedTarget[] = []
  for (const c of candidates) {
    if (c.url === pageUrl) continue
    try {
      const p = new URL(c.url)
      const parts = p.pathname.replace(/\/+$/, '').split('/')
      parts.pop()
      const cdir = parts.join('/') || '/'
      if (cdir !== dir) continue
      const anchor =
        (c.h1 || c.title || '').replace(/\s+/g, ' ').trim() ||
        p.pathname.split('/').filter(Boolean).pop()?.replace(/[-_]+/g, ' ') ||
        'Article'
      out.push({ href: p.pathname + p.search, anchorText: anchor })
      if (out.length >= limit) break
    } catch {
      /* skip */
    }
  }
  return out
}
