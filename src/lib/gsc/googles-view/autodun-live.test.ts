/**
 * Live autodun.com checks for Google's view redirect EXPECTED set.
 * Skips when network is blocked (CI without egress).
 */

import { describe, expect, it } from 'vitest'
import { classifyPageWithRedirect } from './classify-redirect'
import { classifyNotFound404 } from './classify-other'
import { recordRedirectChainEvidence, fetchLiveStatus } from './live-evidence'

const AUTODUN_REDIRECT_URLS = [
  'http://autodun.com/',
  'http://www.autodun.com/',
  'https://www.autodun.com/',
  'http://ev.autodun.com/',
  'https://www.autodun.com/blog/electric-car-charger-map-uk.html',
  'https://www.autodun.com/blog/ev-charging-on-uk-motorways.html',
  'https://www.autodun.com/blog/mot-cost-uk-2026.html',
  'https://www.autodun.com/blog/uk-vehicle-data-tools.html',
]

async function networkOk(): Promise<boolean> {
  try {
    const res = await fetch('https://autodun.com/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(8_000),
      redirect: 'manual',
    })
    return res.status > 0
  } catch {
    return false
  }
}

describe('autodun.com Google\'s view live', () => {
  it('8 redirect URLs are EXPECTED; /contact 404 row is healthy', async () => {
    if (!(await networkOk())) {
      console.warn('skip autodun live — network unavailable')
      return
    }

    const deps = { fetch }
    const results: Array<{ url: string; problem: boolean; reasons: string[] }> =
      []

    for (const url of AUTODUN_REDIRECT_URLS) {
      const chain = await recordRedirectChainEvidence(url, deps)
      const classified = classifyPageWithRedirect({
        pageUrl: url,
        chain,
        inSitemap: false,
        linkedInternally: false,
      })
      results.push({
        url,
        problem: classified.problem,
        reasons: classified.problemReasons,
      })
      expect(classified.problem, `${url} → ${classified.problemReasons.join(',')}`).toBe(
        false,
      )
      expect(classified.verdict).toBe('EXPECTED')
    }

    expect(results).toHaveLength(8)

    const contact = await fetchLiveStatus('https://autodun.com/contact', deps)
    const notFound = classifyNotFound404({
      pageUrl: 'https://autodun.com/contact',
      liveStatus: contact.status,
      inSitemap: true, // listed in sitemap but live 200 → still healthy (stale GSC)
      linkedInternally: false,
      gscValidationPassed: true,
    })
    expect(notFound.problem).toBe(false)
    expect(notFound.detail).toMatch(/Validation passed|Live now returns HTTP 200/)
  }, 60_000)
})
