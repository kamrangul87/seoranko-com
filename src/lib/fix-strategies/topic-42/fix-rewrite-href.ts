/**
 * Topic 42 — rewrite an href to the final destination (fixture-only transform).
 * Does not import the verifier.
 */

export function rewriteAnchorHref(
  html: string,
  fromHref: string,
  toHref: string,
): { html: string; rewritten: number } {
  const variants = hrefVariants(fromHref)
  let rewritten = 0
  let next = html

  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match the href attribute value exactly (including its own query/hash).
    const re = new RegExp(
      `(<a\\b[^>]*\\bhref\\s*=\\s*["'])${escaped}(["'][^>]*>)`,
      'gi',
    )
    next = next.replace(re, (_m, pre: string, post: string) => {
      rewritten++
      return `${pre}${toHref}${post}`
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
  } catch {
    // keep raw
  }
  return Array.from(out)
}
