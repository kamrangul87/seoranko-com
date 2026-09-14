/**
 * Postcondition verifier for the remove-anchor branch.
 *
 * Asserts against live HTML that the href is absent. Must not import the
 * fixer — kept in a separate module with no fixer dependency on purpose.
 */
export function verifyAnchorAbsent(
  liveHtml: string,
  href: string,
): { ok: boolean; detail: string } {
  const variants = buildVariants(href)
  for (const variant of variants) {
    if (htmlContainsHref(liveHtml, variant)) {
      return {
        ok: false,
        detail: `live HTML still contains href ${variant}`,
      }
    }
  }
  return { ok: true, detail: 'href absent from live HTML' }
}

function buildVariants(href: string): string[] {
  const out = new Set<string>([href])
  try {
    const u = new URL(href, 'https://example.invalid')
    out.add(u.pathname + u.search)
    out.add(u.pathname)
  } catch {
    // keep raw
  }
  return [...out]
}

function htmlContainsHref(html: string, href: string): boolean {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `<a\\b[^>]*\\bhref\\s*=\\s*["']${escaped}(?:[#?][^"']*)?["']`,
    'i',
  )
  return re.test(html)
}
