/**
 * Topic 74 — Origin-prefixed external URL (malformed "internal" link).
 *
 * Catches hrefs where an external absolute URL (or scheme-less host) was
 * incorrectly joined under the site origin, e.g.:
 *   https://autodun.com/https://www.gov.uk/check-mot-history
 *   /https://www.gov.uk/...
 *   https://autodun.com/www.gov.uk/...
 *
 * Topic 1 often missed these historically: either the href was skipped as
 * "not fetchable" in edge cases, or it surfaced only as a generic 404 without
 * naming the malformation. This check is pure HTML — no network.
 */

import {
  extractAnchors,
  isSkippableHref,
} from '@/lib/fix-strategies/topic-1/extract-anchors'

/**
 * Auto-unwrap the origin-prefixed malformation to the embedded external URL.
 * Legacy report-only slug kept for docs / owner-copy aliases.
 */
export type Topic74Verdict =
  | 'auto-unwrap-origin-prefix'
  | 'origin-prefixed-external-href'

export type Topic74Finding = {
  verdict: Topic74Verdict
  pageUrl: string
  href: string
  /** Destination after unwrap — also stored as rewriteHref for apply-registry. */
  rewriteHref: string
  resolvedUrl: string
  embeddedExternal: string
  detail: string
  severity: 'high'
  autoFixable: true
  evidenceValues: Record<string, unknown>
}

export type DetectTopic74Result = {
  findings: Topic74Finding[]
  suppressed: Array<{ href: string; reason: string }>
  ok: Array<{ pageUrl: string; verdict: string }>
}

/** Path (after host) embeds another absolute URL or scheme-less www./host.tld */
export function extractEmbeddedExternalFromPath(pathname: string): string | null {
  const path = pathname.startsWith('/') ? pathname.slice(1) : pathname
  if (!path) return null

  // /https://… or /http://…
  const abs = path.match(/^(https?:\/\/.+)$/i)
  if (abs) return abs[1]!

  // /www.example.com/… or /example.co.uk/…
  const hosty = path.match(
    /^(www\.[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?)$/i,
  )
  if (hosty) return `https://${hosty[1]}`

  // residual: path contains "/https://" mid-string after a prefix segment
  const mid = path.match(/https?:\/\/[^\s"']+/i)
  if (mid && path.indexOf(mid[0]!) > 0) return mid[0]!

  return null
}

export function classifyOriginPrefixedHref(
  href: string,
  pageUrl: string,
): { resolvedUrl: string; embeddedExternal: string } | null {
  if (isSkippableHref(href)) return null
  let resolved: URL
  try {
    resolved = new URL(href, pageUrl)
  } catch {
    return null
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return null
  }

  let pageHost: string
  try {
    pageHost = new URL(pageUrl).host
  } catch {
    return null
  }

  // Only same-host resolutions are "prefixed internal" malformations.
  if (resolved.host !== pageHost) return null

  const embedded = extractEmbeddedExternalFromPath(resolved.pathname)
  if (!embedded) return null

  // Confirm embedded target is a different host (not a weird internal path).
  try {
    const emb = new URL(embedded.startsWith('http') ? embedded : `https://${embedded}`)
    if (emb.host === pageHost) return null
  } catch {
    return null
  }

  return { resolvedUrl: resolved.toString(), embeddedExternal: embedded }
}

export function detectOriginPrefixedExternalHrefs(
  html: string,
  pageUrl: string,
): DetectTopic74Result {
  const findings: Topic74Finding[] = []
  const suppressed: Array<{ href: string; reason: string }> = []
  const seen = new Set<string>()

  for (const a of extractAnchors(html)) {
    const hit = classifyOriginPrefixedHref(a.href, pageUrl)
    if (!hit) {
      if (!isSkippableHref(a.href)) {
        suppressed.push({ href: a.href, reason: 'not_origin_prefixed_external' })
      }
      continue
    }
    const key = `${hit.resolvedUrl}|${hit.embeddedExternal}`
    if (seen.has(key)) continue
    seen.add(key)

    findings.push({
      verdict: 'auto-unwrap-origin-prefix',
      pageUrl,
      href: a.href,
      rewriteHref: hit.embeddedExternal,
      resolvedUrl: hit.resolvedUrl,
      embeddedExternal: hit.embeddedExternal,
      severity: 'high',
      autoFixable: true,
      detail:
        `Malformed internal link: an external URL is prefixed with this site's own domain. ` +
        `Declared href "${a.href}" resolves to ${hit.resolvedUrl}, but the intended target ` +
        `appears to be ${hit.embeddedExternal}. Googlebot treats this as a same-host URL ` +
        `(usually 404). Auto-fix rewrites the href to the external URL.`,
      evidenceValues: {
        href: a.href,
        rewriteHref: hit.embeddedExternal,
        resolvedUrl: hit.resolvedUrl,
        embeddedExternal: hit.embeddedExternal,
        neverPromiseIndexing: true,
      },
    })
  }

  return {
    findings,
    suppressed,
    ok:
      findings.length === 0
        ? [{ pageUrl, verdict: 'no_origin_prefixed_external_href' }]
        : [],
  }
}
