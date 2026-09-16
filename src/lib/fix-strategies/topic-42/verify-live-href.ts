/**
 * Topic 42 postcondition verifier.
 *
 * Asserts against the LIVE source HTML and a live fetch of the rewritten
 * destination — never imports the fixer.
 */

import {
  recordRedirectHops,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'

export type LiveHrefRewriteVerification = {
  ok: boolean
  detail: string
}

/**
 * Live postcondition:
 * 1. source HTML contains `expectedHref` and no longer needs the old redirect href
 * 2. fetching `expectedHref` (resolved against sourceUrl) returns 200 in zero redirects
 */
export async function verifyLiveHrefRewritten(
  liveSourceHtml: string,
  sourceUrl: string,
  expectedHref: string,
  oldHref: string | null,
  deps: HopRecordingDeps,
): Promise<LiveHrefRewriteVerification> {
  if (!htmlContainsHref(liveSourceHtml, expectedHref)) {
    return {
      ok: false,
      detail: `live HTML missing rewritten href ${expectedHref}`,
    }
  }

  if (oldHref && htmlContainsExactHref(liveSourceHtml, oldHref)) {
    return {
      ok: false,
      detail: `live HTML still contains old redirect href ${oldHref}`,
    }
  }

  let absolute: string
  try {
    absolute = new URL(expectedHref, sourceUrl).toString()
  } catch {
    return { ok: false, detail: `unparseable expected href ${expectedHref}` }
  }

  // Strip fragment for fetch (never sent)
  const fetchUrl = absolute.replace(/#.*$/, '')
  const chain = await recordRedirectHops(fetchUrl, deps)

  if (chain.hops.some((h) => h.status >= 300 && h.status < 400)) {
    return {
      ok: false,
      detail: `rewritten target still redirects (${chain.hops[0]?.status})`,
    }
  }

  if (chain.finalStatus < 200 || chain.finalStatus >= 300) {
    return {
      ok: false,
      detail: `rewritten target status ${chain.finalStatus}`,
    }
  }

  return {
    ok: true,
    detail: 'live HTML has final href; target returns 200 in zero redirects',
  }
}

function htmlContainsHref(html: string, href: string): boolean {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `<a\\b[^>]*\\bhref\\s*=\\s*["']${escaped}["']`,
    'i',
  )
  return re.test(html)
}

function htmlContainsExactHref(html: string, href: string): boolean {
  return htmlContainsHref(html, href)
}
