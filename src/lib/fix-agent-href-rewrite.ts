/**
 * Mechanical <a href> rewrites for Link Graph findings.
 * Replaces only matching href attributes — never invents destinations.
 */

export interface HrefRewrite {
  /** Absolute (or site-absolute) URL currently linked — the finding target. */
  fromHref: string
  /** Absolute suggested destination from Link Graph. */
  toHref: string
}

export interface HrefRewriteResult {
  html: string
  changed: boolean
  replaced: number
  summary: string
  /** Per-replacement before→after pairs for diff summaries. */
  replacements: Array<{ from: string; to: string }>
}

function hrefVariants(url: string): string[] {
  try {
    const u = new URL(url)
    const path = u.pathname + u.search + u.hash
    const variants = new Set<string>()
    variants.add(url)
    variants.add(path)
    variants.add(u.pathname)
    if (u.pathname.endsWith('/') && u.pathname.length > 1) {
      variants.add(u.pathname.slice(0, -1))
      variants.add(path.replace(u.pathname, u.pathname.slice(0, -1)))
    } else if (u.pathname !== '/') {
      variants.add(`${u.pathname}/`)
    }
    return Array.from(variants)
  } catch {
    return [url]
  }
}

/** Prefer relative path when the original href was relative/root-relative. */
export function formatHrefForRewrite(matchedHref: string, suggestedAbsolute: string): string {
  const trimmed = matchedHref.trim()
  const isAbsolute = /^https?:\/\//i.test(trimmed)
  if (isAbsolute) return suggestedAbsolute
  try {
    const dest = new URL(suggestedAbsolute)
    return `${dest.pathname}${dest.search}${dest.hash}` || '/'
  } catch {
    return suggestedAbsolute
  }
}

/**
 * Replace href attributes that match fromHref with toHref.
 * Only mutates the href attribute value — leaves anchor text and other attrs intact.
 */
export function rewriteHrefInHtml(html: string, fromHref: string, toHref: string): HrefRewriteResult {
  return rewriteHrefsInHtml(html, [{ fromHref, toHref }])
}

/** Apply multiple href rewrites to one HTML document. */
export function rewriteHrefsInHtml(html: string, rewrites: HrefRewrite[]): HrefRewriteResult {
  let next = html
  let replaced = 0
  const replacements: Array<{ from: string; to: string }> = []

  for (const { fromHref, toHref } of rewrites) {
    if (!fromHref || !toHref) continue
    if (fromHref === toHref) continue

    const variants = hrefVariants(fromHref)
    for (const variant of variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(\\bhref\\s*=\\s*)(["'])(${escaped}(?:[#?][^"']*)?)\\2`, 'gi')
      next = next.replace(re, (_match, prefix: string, quote: string, matched: string) => {
        const formatted = formatHrefForRewrite(matched, toHref)
        if (formatted === matched) return `${prefix}${quote}${matched}${quote}`
        replaced++
        replacements.push({ from: matched, to: formatted })
        return `${prefix}${quote}${formatted}${quote}`
      })
    }
  }

  return {
    html: next,
    changed: replaced > 0,
    replaced,
    replacements,
    summary:
      replaced > 0
        ? `Updated ${replaced} href(s) to suggested destination(s).`
        : 'No matching <a href> found for the flagged link(s) in this HTML.',
  }
}

/** True when live HTML no longer contains fromHref and does contain toHref (path or absolute). */
export function verifyHrefRewriteInHtml(
  html: string,
  fromHref: string,
  toHref: string,
): { ok: boolean; detail: string } {
  const fromStillPresent = hrefVariants(fromHref).some((v) => {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`href\\s*=\\s*["']${escaped}(?:[#?][^"']*)?["']`, 'i').test(html)
  })
  if (fromStillPresent) {
    return { ok: false, detail: `Live HTML still links to ${fromHref}.` }
  }

  const toPresent = hrefVariants(toHref).some((v) => {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`href\\s*=\\s*["']${escaped}(?:[#?][^"']*)?["']`, 'i').test(html)
  })
  if (!toPresent) {
    return {
      ok: false,
      detail: `Live HTML no longer has ${fromHref}, but suggested ${toHref} was not found (cache or different template?).`,
    }
  }
  return { ok: true, detail: `Confirmed href updated to ${toHref} on live fetch.` }
}
