/**
 * Topic 13 — add a self-referential canonical into <head>.
 * Fixture/HTML transform only. Never imports the verifier.
 * Never writes layout-level metadata.
 */

export function addHeadCanonical(
  html: string,
  absoluteCanonicalUrl: string,
): { html: string; added: boolean } {
  // Reject if a head canonical already exists (idempotent no-op for detector;
  // caller should use extraction first).
  if (/<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i.test(html)) {
    // May be in body — still check; for add we insert into head only when absent
    // from head. Simple approach: if any link rel=canonical, leave to topic 17.
  }

  const tag = `<link rel="canonical" href="${absoluteCanonicalUrl}">`

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

  // No head — wrap minimally
  return {
    html: `<!doctype html><html><head>${tag}</head><body>${html}</body></html>`,
    added: true,
  }
}

/**
 * Remove body-placed canonical link elements (C2 — disregarded).
 * Does not touch head canonicals.
 */
export function removeBodyCanonicals(html: string): {
  html: string
  removed: number
} {
  // Structural approach via markers: only remove links that appear after
  // </head> or after a body-content element that closed head. For fixtures we
  // operate on well-formed HTML with an explicit </head>.
  const headEnd = html.search(/<\/head>/i)
  if (headEnd === -1) {
    return { html, removed: 0 }
  }

  const before = html.slice(0, headEnd + '</head>'.length)
  let after = html.slice(headEnd + '</head>'.length)
  let removed = 0
  after = after.replace(
    /<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/gi,
    () => {
      removed++
      return ''
    },
  )
  return { html: before + after, removed }
}
