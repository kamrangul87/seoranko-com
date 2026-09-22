import { describe, expect, it } from 'vitest'
import { isSafePublicUrl } from '@/lib/fetch-page-content'
import {
  isDisallowedByRobots,
  parseRobotsForCrawler,
  SEORANKO_CRAWLER_USER_AGENT,
} from './crawler-identity'
import { safeCrawlFetch } from './safe-crawl-fetch'

describe('isSafePublicUrl cloud metadata', () => {
  it('blocks 169.254.169.254 and link-local', () => {
    expect(isSafePublicUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isSafePublicUrl('https://169.254.1.1/')).toBe(false)
  })
  it('blocks metadata.google.internal', () => {
    expect(isSafePublicUrl('http://metadata.google.internal/')).toBe(false)
  })
})

describe('robots for SEORANKO crawler', () => {
  it('parses Disallow for our UA', () => {
    const rules = parseRobotsForCrawler(`
User-agent: SEORANKO-FindingsCrawl
Disallow: /private
Allow: /private/ok

User-agent: *
Disallow: /
`)
    expect(isDisallowedByRobots('https://ex.com/private/x', rules)).toBe(true)
    expect(isDisallowedByRobots('https://ex.com/private/ok', rules)).toBe(false)
    expect(isDisallowedByRobots('https://ex.com/public', rules)).toBe(false)
  })

  it('identifies SEORANKO with contact URL', () => {
    expect(SEORANKO_CRAWLER_USER_AGENT).toMatch(/SEORANKO/)
    expect(SEORANKO_CRAWLER_USER_AGENT).toMatch(/seoranko\.com/)
  })
})

describe('safeCrawlFetch redirect hop check', () => {
  it('refuses public → private redirect', async () => {
    const prev = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('safe.example')) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://169.254.169.254/meta' },
        })
      }
      throw new Error(`unexpected ${url}`)
    }) as typeof fetch

    try {
      const res = await safeCrawlFetch('https://safe.example/page')
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error).toMatch(/isSafePublicUrl/)
        expect(res.redirectHops.some((h) => h.includes('169.254'))).toBe(true)
      }
    } finally {
      globalThis.fetch = prev
    }
  })
})
