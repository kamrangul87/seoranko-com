/**
 * Classify a live-recorded redirect chain for GSC "Page with redirect".
 *
 * EXPECTED when every hop is a host/scheme/trailing-slash canonicalisation
 * (301/308), final returns 200 and is self-canonical, and the source URL is
 * not still in the sitemap or linked internally.
 *
 * Multi-hop is allowed only when *every* hop is host/scheme/slash-only
 * (e.g. http://www → https://www → https://apex). Any other 2+ hop path
 * change is PROBLEM.
 */

import type { RedirectChainEvidence, RedirectClassification } from './types'

function stripWww(host: string): string {
  return host.replace(/^www\./i, '').toLowerCase()
}

function pathKey(pathname: string): string {
  if (pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

/**
 * True when from→to only changes scheme (http/https), www↔apex, and/or
 * trailing slash — same registrable host + same path key.
 */
export function isHostCanonicalisationHop(fromUrl: string, toUrl: string): boolean {
  let from: URL
  let to: URL
  try {
    from = new URL(fromUrl)
    to = new URL(toUrl)
  } catch {
    return false
  }
  if (!/^https?:$/i.test(from.protocol) || !/^https?:$/i.test(to.protocol)) {
    return false
  }
  if (stripWww(from.hostname) !== stripWww(to.hostname)) return false
  if (pathKey(from.pathname) !== pathKey(to.pathname)) return false
  // Query/fragment must not change for "canonicalisation-only"
  if (from.search !== to.search) return false
  return true
}

function isPermanentRedirect(status: number): boolean {
  return status === 301 || status === 308
}

function isTemporaryRedirect(status: number): boolean {
  return status === 302 || status === 307
}

function isHomepagePath(pathname: string): boolean {
  return pathKey(pathname) === '/'
}

function isDeepUrl(url: string): boolean {
  try {
    return !isHomepagePath(new URL(url).pathname)
  } catch {
    return false
  }
}

export type ClassifyPageWithRedirectInput = {
  pageUrl: string
  chain: RedirectChainEvidence
  inSitemap: boolean
  linkedInternally: boolean
}

export function classifyPageWithRedirect(
  input: ClassifyPageWithRedirectInput,
): RedirectClassification {
  const reasons: string[] = []
  const { chain } = input
  const redirectHops = chain.hops.filter((h) => h.status >= 300 && h.status < 400)

  if (redirectHops.length === 0) {
    reasons.push('no_redirect_recorded')
  }

  for (const hop of redirectHops) {
    if (isTemporaryRedirect(hop.status)) {
      reasons.push('temporary_redirect')
    } else if (!isPermanentRedirect(hop.status)) {
      reasons.push('non_permanent_redirect')
    }
    if (!hop.location) {
      reasons.push('missing_location')
      continue
    }
    let next: string
    try {
      next = new URL(hop.location, hop.url).toString()
    } catch {
      reasons.push('invalid_location')
      continue
    }
    if (!isHostCanonicalisationHop(hop.url, next)) {
      // Path-changing hop — if more than one redirect hop overall, or this
      // single hop isn't host canon, mark appropriately below.
      if (redirectHops.length >= 2) {
        reasons.push('multi_hop_non_canonicalisation')
      } else if (!isHostCanonicalisationHop(hop.url, next)) {
        // Single hop that isn't host/scheme/slash — still may be OK as a
        // permanent move only if final healthy; product rule treats only
        // host/scheme/slash as EXPECTED. Anything else is PROBLEM.
        reasons.push('non_canonicalisation_redirect')
      }
    }
  }

  // Soft-404: deep URL lands on homepage
  try {
    const finalPath = new URL(chain.finalUrl).pathname
    if (isDeepUrl(input.pageUrl) && isHomepagePath(finalPath)) {
      reasons.push('soft_404_to_homepage')
    }
  } catch {
    /* ignore */
  }

  if (chain.finalStatus >= 400 || chain.finalStatus === 0) {
    reasons.push('final_4xx_5xx')
  } else if (chain.finalStatus !== 200) {
    reasons.push('final_not_200')
  }

  if (chain.finalStatus === 200 && !chain.finalSelfCanonical) {
    reasons.push('final_canonical_elsewhere')
  }

  if (input.inSitemap) reasons.push('still_in_sitemap')
  if (input.linkedInternally) reasons.push('still_linked_internally')

  const unique = Array.from(new Set(reasons))
  const problem = unique.length > 0
  const related: string[] = []
  if (unique.includes('still_in_sitemap')) related.push('26')
  if (unique.includes('still_linked_internally')) related.push('42')
  if (unique.includes('final_4xx_5xx') || unique.includes('soft_404_to_homepage')) {
    related.push('1')
  }

  return {
    verdict: problem ? 'PROBLEM' : 'EXPECTED',
    problem,
    problemReasons: unique,
    summary: problem
      ? `Action needed: ${unique.join(', ')}`
      : 'Healthy host/scheme/slash redirect; Google indexes the destination.',
    chain,
  }
}
