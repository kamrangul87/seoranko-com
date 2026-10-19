import { describe, expect, it } from 'vitest'
import {
  classifyPageWithRedirect,
  isHostCanonicalisationHop,
} from './classify-redirect'
import type { RedirectChainEvidence } from './types'

function chain(
  hops: Array<{ url: string; status: number; location: string | null }>,
  final: { url: string; status: number; selfCanonical: boolean },
): RedirectChainEvidence {
  return {
    hops: hops.map((h) => ({
      url: h.url,
      status: h.status,
      location: h.location,
    })),
    finalUrl: final.url,
    finalStatus: final.status,
    finalSelfCanonical: final.selfCanonical,
  }
}

describe('isHostCanonicalisationHop', () => {
  it('accepts http→https same host+path', () => {
    expect(
      isHostCanonicalisationHop('http://autodun.com/', 'https://autodun.com/'),
    ).toBe(true)
  })

  it('accepts www↔apex same path', () => {
    expect(
      isHostCanonicalisationHop(
        'https://www.autodun.com/',
        'https://autodun.com/',
      ),
    ).toBe(true)
  })

  it('accepts trailing-slash only', () => {
    expect(
      isHostCanonicalisationHop(
        'https://autodun.com/blog',
        'https://autodun.com/blog/',
      ),
    ).toBe(true)
  })

  it('rejects path changes', () => {
    expect(
      isHostCanonicalisationHop(
        'https://autodun.com/old',
        'https://autodun.com/new',
      ),
    ).toBe(false)
  })
})

describe('classifyPageWithRedirect', () => {
  it('EXPECTED: single http→https hop, final 200 self-canonical', () => {
    const result = classifyPageWithRedirect({
      pageUrl: 'http://autodun.com/',
      chain: chain(
        [
          {
            url: 'http://autodun.com/',
            status: 308,
            location: 'https://autodun.com/',
          },
        ],
        {
          url: 'https://autodun.com/',
          status: 200,
          selfCanonical: true,
        },
      ),
      inSitemap: false,
      linkedInternally: false,
    })
    expect(result.problem).toBe(false)
    expect(result.verdict).toBe('EXPECTED')
  })

  it('EXPECTED: composed www+https hops (each host/scheme only)', () => {
    const result = classifyPageWithRedirect({
      pageUrl: 'http://www.autodun.com/',
      chain: chain(
        [
          {
            url: 'http://www.autodun.com/',
            status: 308,
            location: 'https://www.autodun.com/',
          },
          {
            url: 'https://www.autodun.com/',
            status: 301,
            location: 'https://autodun.com/',
          },
        ],
        {
          url: 'https://autodun.com/',
          status: 200,
          selfCanonical: true,
        },
      ),
      inSitemap: false,
      linkedInternally: false,
    })
    expect(result.problem).toBe(false)
    expect(result.verdict).toBe('EXPECTED')
  })

  it('PROBLEM: 2-hop chain with a non-canonicalisation middle hop', () => {
    const result = classifyPageWithRedirect({
      pageUrl: 'https://example.com/a',
      chain: chain(
        [
          {
            url: 'https://example.com/a',
            status: 301,
            location: 'https://example.com/b',
          },
          {
            url: 'https://example.com/b',
            status: 301,
            location: 'https://example.com/c',
          },
        ],
        { url: 'https://example.com/c', status: 200, selfCanonical: true },
      ),
      inSitemap: false,
      linkedInternally: false,
    })
    expect(result.problem).toBe(true)
    expect(result.verdict).toBe('PROBLEM')
    expect(result.problemReasons).toContain('multi_hop_non_canonicalisation')
  })

  it('PROBLEM: redirect ends on 404', () => {
    const result = classifyPageWithRedirect({
      pageUrl: 'https://example.com/gone',
      chain: chain(
        [
          {
            url: 'https://example.com/gone',
            status: 301,
            location: 'https://example.com/missing',
          },
        ],
        {
          url: 'https://example.com/missing',
          status: 404,
          selfCanonical: true,
        },
      ),
      inSitemap: false,
      linkedInternally: false,
    })
    expect(result.problem).toBe(true)
    expect(result.problemReasons).toContain('final_4xx_5xx')
  })

  it('PROBLEM: temporary 302 for permanent move', () => {
    const result = classifyPageWithRedirect({
      pageUrl: 'https://example.com/a',
      chain: chain(
        [
          {
            url: 'https://example.com/a',
            status: 302,
            location: 'https://example.com/b',
          },
        ],
        { url: 'https://example.com/b', status: 200, selfCanonical: true },
      ),
      inSitemap: false,
      linkedInternally: false,
    })
    expect(result.problem).toBe(true)
    expect(result.problemReasons).toContain('temporary_redirect')
  })

  it('PROBLEM: still in sitemap', () => {
    const result = classifyPageWithRedirect({
      pageUrl: 'http://autodun.com/',
      chain: chain(
        [
          {
            url: 'http://autodun.com/',
            status: 308,
            location: 'https://autodun.com/',
          },
        ],
        {
          url: 'https://autodun.com/',
          status: 200,
          selfCanonical: true,
        },
      ),
      inSitemap: true,
      linkedInternally: false,
    })
    expect(result.problem).toBe(true)
    expect(result.problemReasons).toContain('still_in_sitemap')
  })

  it('PROBLEM: deep URL soft-404 to homepage', () => {
    const result = classifyPageWithRedirect({
      pageUrl: 'https://example.com/blog/old-post',
      chain: chain(
        [
          {
            url: 'https://example.com/blog/old-post',
            status: 301,
            location: 'https://example.com/',
          },
        ],
        { url: 'https://example.com/', status: 200, selfCanonical: true },
      ),
      inSitemap: false,
      linkedInternally: false,
    })
    expect(result.problem).toBe(true)
    expect(result.problemReasons).toContain('soft_404_to_homepage')
  })

  it('PROBLEM: final URL canonicalises elsewhere', () => {
    const result = classifyPageWithRedirect({
      pageUrl: 'https://www.example.com/x',
      chain: chain(
        [
          {
            url: 'https://www.example.com/x',
            status: 301,
            location: 'https://example.com/x',
          },
        ],
        {
          url: 'https://example.com/x',
          status: 200,
          selfCanonical: false,
        },
      ),
      inSitemap: false,
      linkedInternally: false,
    })
    expect(result.problem).toBe(true)
    expect(result.problemReasons).toContain('final_canonical_elsewhere')
  })
})
