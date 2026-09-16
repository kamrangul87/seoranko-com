/**
 * Topic 26 postcondition verifier.
 *
 * Asserts against the LIVE deployed sitemap response — never the repo file.
 * Must not import the fixer module.
 */

import type { FetchDeps } from '@/lib/fix-strategies/fetch'
import { recordRedirectHops } from '@/lib/fix-strategies/shared'
import {
  extractHtmlCanonical,
  hasNoindexDirective,
  isNonHtmlIndexableResource,
  isSelfCanonical,
} from './classify-signals'
import { extractSitemapLocs } from './parse-sitemap'

export type LiveSitemapVerification = {
  ok: boolean
  detail: string
  failures: Array<{ loc: string; reason: string }>
}

/**
 * Fetch the live sitemap URL, then fetch every loc (no redirect follow for the
 * loc itself beyond recording). Every loc must return 200, carry no noindex,
 * and be self-canonical (HTML). Non-HTML 200 resources (PDF) are allowed.
 */
export async function verifyLiveSitemapIndexable(
  liveSitemapUrl: string,
  deps: FetchDeps,
): Promise<LiveSitemapVerification> {
  const sitemapRes = await deps.fetch(liveSitemapUrl, {
    method: 'GET',
    redirect: 'manual',
  })
  if (sitemapRes.status < 200 || sitemapRes.status >= 300) {
    return {
      ok: false,
      detail: `Live sitemap HTTP ${sitemapRes.status}`,
      failures: [],
    }
  }

  const xml = await sitemapRes.text()
  const locs = extractSitemapLocs(xml)
  const failures: LiveSitemapVerification['failures'] = []

  for (const loc of locs) {
    const hops = await recordRedirectHops(loc, { fetch: deps.fetch })
    if (hops.hops.some((h) => h.status >= 300 && h.status < 400)) {
      failures.push({ loc, reason: `redirect status in chain` })
      continue
    }
    if (hops.finalStatus !== 200) {
      failures.push({ loc, reason: `HTTP ${hops.finalStatus}` })
      continue
    }
    const ct = hops.finalHeaders.get('content-type')
    if (isNonHtmlIndexableResource(ct, loc)) continue

    if (hasNoindexDirective(hops.finalHeaders, hops.finalBody, ct)) {
      failures.push({ loc, reason: 'noindex present' })
      continue
    }
    const canonical = extractHtmlCanonical(hops.finalBody, loc, ct)
    if (!isSelfCanonical(loc, canonical) && canonical != null) {
      failures.push({ loc, reason: `canonical elsewhere: ${canonical}` })
    }
  }

  return {
    ok: failures.length === 0,
    detail:
      failures.length === 0
        ? `All ${locs.length} live locs are 200, indexable, self-canonical`
        : `${failures.length} loc(s) failed postcondition`,
    failures,
  }
}
