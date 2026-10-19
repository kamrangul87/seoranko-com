import { describe, expect, it } from 'vitest'
import { buildGooglesView } from './build'
import type { RedirectChainEvidence } from './types'

function redirectChain(
  hops: Array<{ url: string; status: number; location: string | null }>,
  final: { url: string; status: number; selfCanonical: boolean },
): RedirectChainEvidence {
  return {
    hops,
    finalUrl: final.url,
    finalStatus: final.status,
    finalSelfCanonical: final.selfCanonical,
  }
}

describe('buildGooglesView', () => {
  it('marks fixture 2-hop path chain as PROBLEM and redirect→404 as PROBLEM', () => {
    const liveByUrl = new Map([
      [
        'https://example.com/a',
        {
          redirectChain: redirectChain(
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
            {
              url: 'https://example.com/c',
              status: 200,
              selfCanonical: true,
            },
          ),
        },
      ],
      [
        'https://example.com/gone',
        {
          redirectChain: redirectChain(
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
        },
      ],
    ])

    const table = buildGooglesView({
      siteId: 'site-1',
      inspections: [
        { url: 'https://example.com/a', coverageState: 'Page with redirect' },
        {
          url: 'https://example.com/gone',
          coverageState: 'Page with redirect',
        },
      ],
      liveByUrl,
      sitemapUrls: new Set(),
      linkedInternallyUrls: new Set(),
    })

    expect(table.rows).toHaveLength(1)
    const row = table.rows[0]!
    expect(row.reason).toBe('Page with redirect')
    expect(row.problem).toBe(true)
    expect(row.pageCount).toBe(2)
    const twoHop = row.urls.find((u) => u.url === 'https://example.com/a')
    const to404 = row.urls.find((u) => u.url === 'https://example.com/gone')
    expect(twoHop?.problem).toBe(true)
    expect(twoHop?.problemReasons).toContain('multi_hop_non_canonicalisation')
    expect(to404?.problem).toBe(true)
    expect(to404?.problemReasons).toContain('final_4xx_5xx')
  })

  it('marks healthy 404 when live is 200 (stale GSC)', () => {
    const table = buildGooglesView({
      siteId: 'site-1',
      inspections: [
        {
          url: 'https://autodun.com/contact',
          coverageState: 'Not found (404)',
          gscValidationPassed: true,
        },
      ],
      liveByUrl: new Map([
        ['https://autodun.com/contact', { liveStatus: 200 }],
      ]),
      sitemapUrls: new Set(['https://autodun.com/contact']),
      linkedInternallyUrls: new Set(),
    })
    const row = table.rows[0]!
    expect(row.problem).toBe(false)
    expect(row.urls[0]!.detail).toMatch(/Validation passed/)
  })

  it('explains crawled-not-indexed as Google\'s choice with Index Diagnosis causes', () => {
    const table = buildGooglesView({
      siteId: 'site-1',
      inspections: [
        {
          url: 'https://autodun.com/blog/thin',
          coverageState: 'Crawled - currently not indexed',
        },
      ],
      liveByUrl: new Map(),
      sitemapUrls: new Set(),
      linkedInternallyUrls: new Set(),
      diagnosisCausesByUrl: new Map([
        [
          'https://autodun.com/blog/thin',
          {
            url: 'https://autodun.com/blog/thin',
            causes: ['depth=4', 'inbound_links=0', 'duplicate_cluster'],
          },
        ],
      ]),
    })
    const detail = table.rows[0]!.urls[0]!.detail
    expect(detail).toMatch(/Google's choice/)
    expect(detail).toMatch(/depth=4/)
    expect(table.rows[0]!.problem).toBe(false)
  })
})
