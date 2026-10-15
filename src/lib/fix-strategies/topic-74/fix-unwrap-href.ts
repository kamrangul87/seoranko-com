/**
 * Topic 74 — rewrite an origin-prefixed external href to the real external URL.
 * Supports straight and curly attribute quotes (CMS paste).
 */

const CURLY_OPEN = '[\u201C\u2018"\']'
const CURLY_CLOSE = '[\u201D\u2019"\']'

export function unwrapOriginPrefixedHref(
  html: string,
  fromHref: string,
  toHref: string,
): { html: string; rewritten: number } {
  const variants = hrefVariants(fromHref)
  let rewritten = 0
  let next = html

  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(
      `(<a\\b[^>]*\\bhref\\s*=\\s*)(${CURLY_OPEN})(${escaped})(${CURLY_CLOSE})`,
      'gi',
    )
    next = next.replace(re, (_m, pre: string) => {
      rewritten++
      // Always emit straight double quotes — valid HTML, JSON-safe in PRs.
      return `${pre}"${toHref}"`
    })
  }

  return { html: next, rewritten }
}

function hrefVariants(href: string): string[] {
  const out = new Set<string>([href])
  try {
    const u = new URL(href, 'https://example.invalid')
    out.add(u.pathname + u.search + u.hash)
    out.add(u.pathname + u.search)
    out.add(u.pathname)
    // Absolute form under a placeholder host when input was path-only.
    if (href.startsWith('/')) {
      out.add(`https://example.invalid${href}`)
    }
  } catch {
    // keep raw
  }
  return Array.from(out)
}
