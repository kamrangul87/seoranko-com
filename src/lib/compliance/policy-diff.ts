/**
 * Privacy-policy discovery and deterministic section / vendor diffs.
 * ICO privacy notice structure (sections) —
 * https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/
 */

import type { VendorSignature } from './vendor-signatures'
import { VENDOR_SIGNATURES } from './vendor-signatures'

export type PrivacyPageHit = {
  pageUrl: string
  html: string
  discoveredVia: 'footer_link' | 'path_heuristic'
}

export type PolicySectionId =
  | 'controller_identity'
  | 'contact'
  | 'lawful_basis'
  | 'recipients'
  | 'international_transfers'
  | 'retention'
  | 'rights'

/** Phrase patterns per required ICO-style section. */
export const SECTION_PATTERNS: Record<
  PolicySectionId,
  { label: string; patterns: RegExp[] }
> = {
  controller_identity: {
    label: 'controller identity',
    patterns: [
      /data\s+controller/i,
      /controller\s+of\s+(?:your\s+)?(?:personal\s+)?data/i,
      /we\s+are\s+the\s+controller/i,
      /registered\s+(?:office|company)/i,
    ],
  },
  contact: {
    label: 'contact',
    patterns: [
      /contact\s+us/i,
      /privacy\s*@/i,
      /dpo@/i,
      /data\s+protection\s+officer/i,
      /email\s*:\s*\S+@\S+/i,
    ],
  },
  lawful_basis: {
    label: 'lawful basis',
    patterns: [
      /lawful\s+basis/i,
      /legal\s+basis/i,
      /legitimate\s+interest/i,
      /consent\s+as\s+(?:a\s+)?(?:lawful|legal)\s+basis/i,
      /article\s+6/i,
    ],
  },
  recipients: {
    label: 'recipients',
    patterns: [
      /recipients?/i,
      /third[\s-]part(?:y|ies)/i,
      /share(?:d|s)?\s+(?:your\s+)?(?:personal\s+)?(?:data|information)\s+with/i,
      /processors?/i,
      /service\s+providers?/i,
    ],
  },
  international_transfers: {
    label: 'international transfers',
    patterns: [
      /international\s+transfer/i,
      /transfer(?:s|red)?\s+(?:outside|beyond)\s+the\s+(?:uk|eea|eu)/i,
      /adequacy\s+decision/i,
      /standard\s+contractual\s+clauses/i,
      /SCCs?/i,
    ],
  },
  retention: {
    label: 'retention',
    patterns: [
      /retention/i,
      /how\s+long\s+we\s+(?:keep|store|retain)/i,
      /retain(?:ed|s)?\s+for/i,
      /storage\s+period/i,
    ],
  },
  rights: {
    label: 'rights',
    patterns: [
      /your\s+rights/i,
      /right\s+to\s+(?:access|erasure|rectification|object|portability)/i,
      /withdraw\s+(?:your\s+)?consent/i,
      /supervisory\s+authority/i,
      /complain\s+to\s+(?:a\s+)?(?:supervisory|data\s+protection)\s+authority/i,
    ],
  },
}

const PRIVACY_HREF_RE =
  /(?:privacy|data[\s_-]?protection|datenschutz|politique[\s_-]?de[\s_-]?confidentialit)/i
const PRIVACY_TEXT_RE =
  /privacy|data\s+protection|datenschutz|politique\s+de\s+confidentialit/i

export type PageForPrivacySearch = {
  url: string
  html: string
}

/** Path looks like a privacy / data-protection page. */
export function isPrivacyPath(pathname: string): boolean {
  return /privacy|data-protection|data_protection|datenschutz/i.test(pathname)
}

/** Find page in crawl set matching a resolved URL (host+path; slash/case tolerant). */
export function findPageByUrl(
  pages: PageForPrivacySearch[],
  targetUrl: string,
): PageForPrivacySearch | undefined {
  const want = normalizeUrl(targetUrl)
  const byExact = pages.find((x) => normalizeUrl(x.url) === want)
  if (byExact) return byExact
  // Fallback: same host + path (covers origin with/without trailing slash bases).
  try {
    const t = new URL(targetUrl)
    const wantHost = t.hostname.replace(/^www\./i, '').toLowerCase()
    const wantPath = (t.pathname.replace(/\/$/, '') || '/').toLowerCase()
    return pages.find((x) => {
      try {
        const u = new URL(x.url)
        const host = u.hostname.replace(/^www\./i, '').toLowerCase()
        const path = (u.pathname.replace(/\/$/, '') || '/').toLowerCase()
        return host === wantHost && path === wantPath
      } catch {
        return false
      }
    })
  } catch {
    return undefined
  }
}

/** Find privacy page via footer-ish links, then path heuristic. */
export function findPrivacyPage(
  pages: PageForPrivacySearch[],
): PrivacyPageHit | null {
  for (const p of pages) {
    const linkRe =
      /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = linkRe.exec(p.html)) !== null) {
      const href = m[1] ?? ''
      const text = (m[2] ?? '').replace(/<[^>]+>/g, ' ').trim()
      if (!PRIVACY_HREF_RE.test(href) && !PRIVACY_TEXT_RE.test(text)) continue
      // Normalize base so `https://host` and `https://host/` both resolve /privacy.html.
      const resolved = resolveUrl(href, canonicalizeBase(p.url))
      if (!resolved) continue
      const target = findPageByUrl(pages, resolved)
      if (target) {
        return {
          pageUrl: target.url,
          html: target.html,
          discoveredVia: 'footer_link',
        }
      }
    }
  }

  for (const p of pages) {
    try {
      const pathName = new URL(p.url).pathname
      if (isPrivacyPath(pathName)) {
        return {
          pageUrl: p.url,
          html: p.html,
          discoveredVia: 'path_heuristic',
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Ensure origin-only bases have a trailing slash so relative /path resolves. */
function canonicalizeBase(url: string): string {
  try {
    const u = new URL(url)
    if (u.pathname === '' || u.pathname === '/') {
      u.pathname = '/'
    }
    return u.href
  } catch {
    return url.endsWith('/') ? url : `${url}/`
  }
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href
  } catch {
    return null
  }
}

export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u)
    x.hash = ''
    const path = x.pathname.replace(/\/$/, '') || '/'
    return `${x.origin.toLowerCase()}${path.toLowerCase()}`
  } catch {
    return u.replace(/\/$/, '').toLowerCase()
  }
}

export function missingPolicySections(html: string): PolicySectionId[] {
  const missing: PolicySectionId[] = []
  for (const id of Object.keys(SECTION_PATTERNS) as PolicySectionId[]) {
    const { patterns } = SECTION_PATTERNS[id]
    if (!patterns.some((re) => re.test(html))) missing.push(id)
  }
  return missing
}

export function vendorNamedOnPage(
  html: string,
  vendor: VendorSignature,
): boolean {
  // Strip tags so short aliases (e.g. "meta") do not hit <meta …>.
  const text = html.replace(/<[^>]+>/g, ' ').toLowerCase()
  const display = vendor.displayName.toLowerCase()
  if (text.includes(display)) return true
  return vendor.nameAliases.some((a) => {
    const alias = a.toLowerCase().trim()
    if (!alias) return false
    // Word-boundary match for short aliases; substring OK for multi-word.
    if (alias.includes(' ') || alias.length >= 6) {
      return text.includes(alias)
    }
    const re = new RegExp(
      `(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
      'i',
    )
    return re.test(text)
  })
}

/** Vendors named in policy text that we do not detect on the site. */
export function vendorsNamedButNotDetected(
  policyHtml: string,
  detectedIds: Set<string>,
): VendorSignature[] {
  return VENDOR_SIGNATURES.filter(
    (v) =>
      !detectedIds.has(v.id) && vendorNamedOnPage(policyHtml, v),
  )
}
