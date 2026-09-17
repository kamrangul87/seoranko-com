/**
 * Topic 46 — add a missing reciprocal (or self) hreflang annotation.
 *
 * Deterministic only when the locale comes from an authoritative repo source
 * and the declaration method is HTML <link> in <head>. Header / sitemap
 * methods need their own writers; this module covers the HTML path.
 */

export type AddHreflangAnnotationOptions = {
  hreflang: string
  href: string
}

/**
 * Insert `<link rel="alternate" hreflang="…" href="…">` into <head>.
 * Idempotent when an equivalent annotation is already present.
 */
export function addReciprocalHreflangAnnotation(
  html: string,
  opts: AddHreflangAnnotationOptions,
): { html: string; added: boolean } {
  const lang = opts.hreflang.trim()
  const href = opts.href.trim()
  if (!lang || !href) return { html, added: false }

  const already = new RegExp(
    `<link\\b[^>]*\\brel\\s*=\\s*["'][^"']*alternate[^"']*["'][^>]*\\bhreflang\\s*=\\s*["']${escapeRegExp(lang)}["'][^>]*\\bhref\\s*=\\s*["']${escapeRegExp(href)}["'][^>]*>`,
    'i',
  )
  const alreadyAlt = new RegExp(
    `<link\\b[^>]*\\bhreflang\\s*=\\s*["']${escapeRegExp(lang)}["'][^>]*\\brel\\s*=\\s*["'][^"']*alternate[^"']*["'][^>]*\\bhref\\s*=\\s*["']${escapeRegExp(href)}["'][^>]*>`,
    'i',
  )
  if (already.test(html) || alreadyAlt.test(html)) {
    return { html, added: false }
  }

  const tag = `<link rel="alternate" hreflang="${lang}" href="${href}" />`

  if (/<\/head>/i.test(html)) {
    return {
      html: html.replace(/<\/head>/i, `  ${tag}\n</head>`),
      added: true,
    }
  }
  if (/<head[^>]*>/i.test(html)) {
    return {
      html: html.replace(/<head([^>]*)>/i, `<head$1>\n  ${tag}`),
      added: true,
    }
  }
  return {
    html: `<!doctype html><html><head>${tag}</head><body>${html}</body></html>`,
    added: true,
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
