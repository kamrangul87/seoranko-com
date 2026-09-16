/**
 * Remove `<a … href="…">…</a>` elements whose href matches the dead target.
 * Fixture-only transform — does not write to a customer repo.
 *
 * Intentionally does not import the verifier (and the verifier must not import
 * this module).
 */
export function removeAnchorByHref(
  html: string,
  href: string,
): { html: string; removed: number } {
  const variants = hrefVariants(href)
  let removed = 0
  let next = html

  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(
      `<a\\b[^>]*\\bhref\\s*=\\s*["']${escaped}(?:[#?][^"']*)?["'][^>]*>[\\s\\S]*?<\\/a>`,
      'gi',
    )
    next = next.replace(re, () => {
      removed++
      return ''
    })
  }

  return { html: next, removed }
}

function hrefVariants(href: string): string[] {
  const out = new Set<string>([href])
  try {
    const u = new URL(href, 'https://example.invalid')
    out.add(u.pathname + u.search)
    out.add(u.pathname)
  } catch {
    // keep raw
  }
  return Array.from(out)
}
