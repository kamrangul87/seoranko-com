import { describe, expect, it, vi, afterEach } from 'vitest'
import dns from 'node:dns/promises'
import {
  assertSafePublicUrlResolved,
  isSafePublicUrl,
} from '@/lib/fetch-page-content'
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
  it('blocks metadata.google.internal and 0.0.0.0/8', () => {
    expect(isSafePublicUrl('http://metadata.google.internal/')).toBe(false)
    expect(isSafePublicUrl('http://0.0.0.0/')).toBe(false)
  })
})

describe('assertSafePublicUrlResolved DNS', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses a public hostname that resolves to a private IP', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
    ] as never)
    expect(await assertSafePublicUrlResolved('https://evil-public.example/path')).toBe(
      false,
    )
  })

  it('refuses a hostname that resolves to 169.254.169.254', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '169.254.169.254', family: 4 },
    ] as never)
    expect(await assertSafePublicUrlResolved('https://imds-alias.example/')).toBe(false)
  })

  it('allows a hostname that resolves to a public IP', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)
    expect(await assertSafePublicUrlResolved('https://example.com/')).toBe(true)
  })
})

describe('robots for SEORANKOBot', () => {
  it('parses Disallow for our UA', () => {
    const rules = parseRobotsForCrawler(`
User-agent: SEORANKOBot
Disallow: /private
Allow: /private/ok

User-agent: *
Disallow: /
`)
    expect(isDisallowedByRobots('https://ex.com/private/x', rules)).toBe(true)
    expect(isDisallowedByRobots('https://ex.com/private/ok', rules)).toBe(false)
    expect(isDisallowedByRobots('https://ex.com/public', rules)).toBe(false)
  })

  it('identifies SEORANKOBot with /bot contact URL', () => {
    expect(SEORANKO_CRAWLER_USER_AGENT).toBe(
      'SEORANKOBot/1.0 (+https://seoranko.com/bot)',
    )
  })
})

describe('safeCrawlFetch redirect hop check', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses public → private redirect', async () => {
    const prev = globalThis.fetch
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)

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
        expect(res.error).toMatch(/assertSafePublicUrlResolved|isSafePublicUrl/)
        expect(res.redirectHops.some((h) => h.includes('169.254'))).toBe(true)
      }
    } finally {
      globalThis.fetch = prev
    }
  })
})
