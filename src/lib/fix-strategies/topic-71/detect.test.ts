import { describe, expect, it } from 'vitest'
import { detectPaginationSeriesIssues } from './detect'

const ORIGIN = 'https://example.com'

describe('topic 71 pagination series', () => {
  it('raises when page 2+ canonicalises to series first page', () => {
    const r = detectPaginationSeriesIssues({
      pages: [
        {
          url: `${ORIGIN}/shop?page=2`,
          status: 200,
          html: `<!doctype html><html><head>
            <link rel="canonical" href="${ORIGIN}/shop" />
          </head><body>
            <a href="${ORIGIN}/shop?page=3">3</a>
          </body></html>`,
        },
      ],
    })
    expect(r.findings.some((f) => f.verdict === 'page-canonical-to-series-first')).toBe(
      true,
    )
    expect(r.findings[0]!.autoFixable).toBe(false)
  })

  it('does not raise when page 2 self-canonicalises', () => {
    const r = detectPaginationSeriesIssues({
      pages: [
        {
          url: `${ORIGIN}/shop?page=2`,
          status: 200,
          html: `<!doctype html><html><head>
            <link rel="canonical" href="${ORIGIN}/shop?page=2" />
          </head><body>
            <a href="${ORIGIN}/shop?page=3">3</a>
          </body></html>`,
        },
      ],
    })
    expect(r.findings.filter((f) => f.verdict === 'page-canonical-to-series-first')).toHaveLength(
      0,
    )
  })

  it('raises fragment-only pagination links', () => {
    const r = detectPaginationSeriesIssues({
      pages: [
        {
          url: `${ORIGIN}/blog`,
          status: 200,
          html: `<!doctype html><html><body>
            <a href="#page-2">2</a>
          </body></html>`,
        },
      ],
    })
    expect(r.findings.some((f) => f.verdict === 'fragment-only-pagination')).toBe(true)
  })

  it('never treats missing rel=next/prev as a finding', () => {
    const r = detectPaginationSeriesIssues({
      pages: [
        {
          url: `${ORIGIN}/shop?page=1`,
          status: 200,
          html: `<!doctype html><html><body>
            <a href="${ORIGIN}/shop?page=2">2</a>
          </body></html>`,
        },
      ],
    })
    expect(
      r.findings.every(
        (f) => f.verdict !== 'informational-rel-next-prev-unused-by-google',
      ),
    ).toBe(true)
    // Presence is informational only
    const withRel = detectPaginationSeriesIssues({
      pages: [
        {
          url: `${ORIGIN}/shop?page=1`,
          status: 200,
          html: `<!doctype html><html><head>
            <link rel="next" href="${ORIGIN}/shop?page=2" />
          </head><body>
            <a href="${ORIGIN}/shop?page=2">2</a>
          </body></html>`,
        },
      ],
    })
    expect(
      withRel.informational.some(
        (f) => f.verdict === 'informational-rel-next-prev-unused-by-google',
      ),
    ).toBe(true)
    expect(withRel.informational[0]!.evidenceValues.googleUsesRelNextPrev).toBe(false)
  })

  it('flags noncrawlable next when rel=next exists without crawlable page-2 href', () => {
    const r = detectPaginationSeriesIssues({
      pages: [
        {
          url: `${ORIGIN}/shop`,
          status: 200,
          html: `<!doctype html><html><head>
            <link rel="next" href="${ORIGIN}/shop?page=2" />
          </head><body>
            <button data-page="2">…</button>
          </body></html>`,
        },
      ],
    })
    expect(
      r.findings.some((f) => f.verdict === 'noncrawlable-next-without-href'),
    ).toBe(true)
  })
})
