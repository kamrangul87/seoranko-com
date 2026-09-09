/**
 * Mechanical removal of dead internal links from HTML and component sources.
 * Never invents destination pages — only removes the outbound link.
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

/** Remove anchor tags whose href matches deadUrl (relative or absolute). */
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

/**
 * Mechanical dead-link removal for React/Vue-style source files.
 * Handles:
 * - <a href="…">…</a>
 * - <Link to="…">…</Link> / <Link to={'…'}>
 * - { path: "/privacy", label: "…" } objects in link arrays (drops the whole object)
 */
export function removeDeadLinkFromSource(
  source: string,
  deadUrl: string,
): { content: string; changed: boolean; removed: number; summary: string } {
  const variants = hrefVariants(deadUrl)
  let removed = 0
  let next = source

  // Drop whole `{ path: "/privacy", label: "…" }` / `{ href: "…" }` objects in arrays.
  for (const href of variants) {
    const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const objRe = new RegExp(
      `,?\\s*\\{[^{}]*?(?:path|href)\\s*:\\s*["'\`]${escaped}["'\`][^{}]*?\\}`,
      'gi',
    )
    next = next.replace(objRe, (match) => {
      removed++
      // Keep a single comma when we removed a middle element: ",{…}," → ","
      return match.trimStart().startsWith(',') ? '' : ''
    })
  }

  // <Link to="/privacy">…</Link> (and optional props before/after to=)
  for (const href of variants) {
    const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const linkRe = new RegExp(
      `<Link\\b[^>]*\\bto\\s*=\\s*(?:\\{?["'\`]${escaped}(?:[#?][^"'\`]*)?["'\`]\\}?)[^>]*>[\\s\\S]*?<\\/Link>`,
      'gi',
    )
    next = next.replace(linkRe, () => {
      removed++
      return ''
    })
  }

  // Plain <a href> still present in .tsx templates
  const htmlPass = removeDeadLinkFromHtml(next, deadUrl)
  next = htmlPass.html
  removed += htmlPass.removed

  // Tidy double commas / empty slots left by object removal
  next = next
    .replace(/\[\s*,/g, '[')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*]/g, ']')

  return {
    content: next,
    changed: removed > 0 || next !== source,
    removed,
    summary:
      removed > 0
        ? `Removed ${removed} dead link reference(s) to ${deadUrl} from source.`
        : `No matching dead link reference to ${deadUrl} found in this source file.`,
  }
}
