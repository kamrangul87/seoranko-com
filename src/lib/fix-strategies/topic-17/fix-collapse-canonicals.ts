/**
 * Topic 17 — collapse redundant canonicals / remove body misplaced.
 * Does not import the verifier. Never keeps "first by document order" as intent —
 * for redundant, all targets are identical so any surviving copy is fine;
 * for conflicting, do not auto-apply.
 */

import { parseHtml } from '@/lib/fix-strategies/shared'

/**
 * Keep a single head canonical with `href`, remove all other document
 * link[rel=canonical] (head duplicates + body).
 */
export function collapseToSingleHeadCanonical(
  html: string,
  href: string,
): { html: string; removed: number } {
  const parsed = parseHtml(html)
  const headLinks = parsed.headElements('link').filter((el) =>
    (el.attrs.rel ?? '')
      .toLowerCase()
      .split(/\s+/)
      .includes('canonical'),
  )
  const bodyLinks = parsed.bodyElements('link').filter((el) =>
    (el.attrs.rel ?? '')
      .toLowerCase()
      .split(/\s+/)
      .includes('canonical'),
  )

  // String-level: remove every canonical link, then insert one in head.
  let removed = 0
  let next = html.replace(
    /<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/gi,
    () => {
      removed++
      return ''
    },
  )
  // Also href-before-rel variants already covered by rel=canonical in tag.

  const tag = `<link rel="canonical" href="${href}">`
  if (/<\/head>/i.test(next)) {
    next = next.replace(/<\/head>/i, `  ${tag}\n</head>`)
  } else if (/<head[^>]*>/i.test(next)) {
    next = next.replace(/<head([^>]*)>/i, `<head$1>\n  ${tag}`)
  } else {
    next = `<!doctype html><html><head>${tag}</head><body>${next}</body></html>`
  }

  // If we removed nothing and there were no links, still "added"
  void headLinks
  void bodyLinks
  return { html: next, removed }
}

/**
 * Remove only body-placed canonical links; leave head intact.
 */
export function removeBodyCanonicalLinks(html: string): {
  html: string
  removed: number
} {
  const headEnd = html.search(/<\/head>/i)
  if (headEnd === -1) {
    // No explicit head close — use parser positions via full collapse of body
    // only by removing links that are NOT the first head one. Safer: remove
    // all then re-add head ones from parse.
    const parsed = parseHtml(html)
    const headHrefs = parsed
      .headElements('link')
      .filter((el) =>
        (el.attrs.rel ?? '')
          .toLowerCase()
          .split(/\s+/)
          .includes('canonical'),
      )
      .map((el) => el.attrs.href)
      .filter(Boolean) as string[]

    let removed = 0
    let next = html.replace(
      /<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/gi,
      () => {
        removed++
        return ''
      },
    )
    for (const href of headHrefs) {
      const tag = `<link rel="canonical" href="${href}">`
      if (/<\/head>/i.test(next)) {
        next = next.replace(/<\/head>/i, `  ${tag}\n</head>`)
      } else if (/<head[^>]*>/i.test(next)) {
        next = next.replace(/<head([^>]*)>/i, `<head$1>\n  ${tag}`)
      }
      removed-- // restored
    }
    return { html: next, removed: Math.max(0, removed) }
  }

  const before = html.slice(0, headEnd + 7)
  let after = html.slice(headEnd + 7)
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
