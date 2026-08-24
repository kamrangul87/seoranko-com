/**
 * Bare site-root URLs (https://example.com or https://example.com/) are not
 * specific pages. They must not count as claim-evidence sources, and must
 * not be injected into paragraphs that state financial figures.
 *
 * Path-bearing URLs (https://example.com/running-costs) remain citable.
 * Not brand-specific — any origin with an empty path is a root.
 */

export function isBareDomainRootUrl(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  try {
    const withScheme = /^\s*https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const path = (u.pathname || '/').replace(/\/+$/, '')
    return path === ''
  } catch {
    return false
  }
}

/** Visible money / grant-style figures that must not inherit a homepage cite. */
export function textContainsFinancialFigure(text: string): boolean {
  const plain = text.replace(/<[^>]+>/g, ' ')
  return /[£$€]\s?[\d,]|\d+\s?%/.test(plain)
}

export function enclosingParagraphHtml(html: string, index: number): string {
  const start = html.lastIndexOf('<p', index)
  const end = html.indexOf('</p>', index)
  if (start !== -1 && end !== -1 && end > start && start <= index) {
    return html.slice(start, end + 4)
  }
  const windowStart = Math.max(0, index - 220)
  return html.slice(windowStart, Math.min(html.length, index + 220))
}

/**
 * When the registry only has a site homepage (no specific page URL),
 * financial claims cannot be internally sourced. Surface that gap instead
 * of silently treating the homepage as a citation.
 */
export function describeInternalLinkRegistryGap(opts: {
  brand: string
  keyword: string
  registeredUrls: string[]
  eligibleUrls: string[]
}): string | undefined {
  const registered = opts.registeredUrls.filter(Boolean)
  if (registered.length === 0) return undefined

  const specificRegistered = registered.filter((u) => !isBareDomainRootUrl(u))
  const homepageRegistered = registered.filter((u) => isBareDomainRootUrl(u))
  const specificEligible = opts.eligibleUrls.filter((u) => !isBareDomainRootUrl(u))
  const homepageEligible = opts.eligibleUrls.filter((u) => isBareDomainRootUrl(u))

  if (homepageRegistered.length > 0 && specificRegistered.length === 0) {
    const example = homepageRegistered[0]
    return (
      `The link registry for "${opts.brand}" only lists the site homepage (${example}). ` +
      `Homepage URLs are not used as sources for prices or grant figures. ` +
      `Add a specific page in Settings → Link Registry (for example a running-costs or grants guide) ` +
      `so those claims can be cited.`
    )
  }

  if (
    homepageEligible.length > 0 &&
    specificEligible.length === 0 &&
    specificRegistered.length > 0
  ) {
    return (
      `The link registry for "${opts.brand}" has specific pages, but none scored relevant for "${opts.keyword}" ` +
      `— only the homepage was eligible. Homepage URLs are not used as sources for financial figures. ` +
      `Add topic tags or a page that matches this article in Settings → Link Registry.`
    )
  }

  return undefined
}
