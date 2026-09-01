/**
 * Mechanical removal of dead internal links from HTML — no invented destinations.
 */

function hrefVariants(deadUrl: string): string[] {
  try {
    const u = new URL(deadUrl)
    const path = u.pathname
    const variants = new Set<string>()
    variants.add(deadUrl)
    variants.add(path)
    if (path.endsWith('/') && path.length > 1) variants.add(path.slice(0, -1))
    else if (path !== '/') variants.add(`${path}/`)
    return Array.from(variants)
  } catch {
    return [deadUrl]
  }
}

/** Remove anchor tags whose href matches deadUrl (relative or absolute). Returns updated HTML. */
export function removeDeadLinkFromHtml(
  html: string,
  deadUrl: string,
): { html: string; changed: boolean; removed: number; summary: string } {
  const variants = hrefVariants(deadUrl)
  let removed = 0
  let next = html

  for (const href of variants) {
    const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(
      `<a\\b[^>]*\\bhref\\s*=\\s*["']${escaped}(?:[#?][^"']*)?["'][^>]*>[\\s\\S]*?<\\/a>`,
      'gi',
    )
    next = next.replace(re, () => {
      removed++
      return ''
    })
  }

  return {
    html: next,
    changed: removed > 0,
    removed,
    summary:
      removed > 0
        ? `Removed ${removed} dead link(s) to ${deadUrl}.`
        : `No matching <a href> to ${deadUrl} found in this file.`,
  }
}
