import { describe, expect, it } from 'vitest'
import { detectNoindexShouldIndex } from '@/lib/fix-strategies/topic-19'
import { detectMetaHeaderDisagree } from '@/lib/fix-strategies/topic-20'
import { expandRobotsDirectives, hasNoindexDirective } from '@/lib/fix-strategies/shared'

const ORIGIN = 'https://example.com'

function page(opts: {
  robots?: string
  canonical?: string
  bodyRobots?: boolean
}): string {
  const robots = opts.robots
    ? `<meta name="robots" content="${opts.robots}">`
    : ''
  const canon = opts.canonical
    ? `<link rel="canonical" href="${opts.canonical}">`
    : ''
  const bodyMeta = opts.bodyRobots
    ? `<meta name="robots" content="noindex">`
    : ''
  return `<!doctype html><html><head><title>t</title>${robots}${canon}</head><body>${bodyMeta}<p>hi</p></body></html>`
}

describe('topic 19 — noindex contradiction', () => {
  it('classifies the dossier fixture set', () => {
    const result = detectNoindexShouldIndex([
      // 1. repo-declared + sitemap → contradiction
      {
        url: `${ORIGIN}/listed`,
        body: page({ robots: 'noindex', canonical: `${ORIGIN}/listed` }),
        inSitemap: true,
        repoNoindex: 'true',
      },
      // 2. injected → topic 2a
      {
        url: `${ORIGIN}/injected`,
        body: page({ robots: 'noindex' }),
        inSitemap: true,
        repoNoindex: 'false',
      },
      // 3. noindex absent from sitemap → suppress
      {
        url: `${ORIGIN}/hidden`,
        body: page({ robots: 'noindex' }),
        inSitemap: false,
        repoNoindex: 'true',
      },
      // 4. layout cascade
      {
        url: `${ORIGIN}/child`,
        body: page({ robots: 'noindex' }),
        inSitemap: true,
        repoNoindex: 'true',
        cascadeSource: 'app/layout.tsx',
      },
      // 5. generateMetadata indeterminate
      {
        url: `${ORIGIN}/draft`,
        body: page({ robots: 'noindex' }),
        inSitemap: true,
        repoNoindex: 'indeterminate',
      },
      // 6. none expands to noindex
      {
        url: `${ORIGIN}/none`,
        body: page({ robots: 'NONE', canonical: `${ORIGIN}/none` }),
        inSitemap: true,
        repoNoindex: 'true',
      },
    ])

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/listed`)?.verdict,
    ).toMatch(/contradiction/)

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/injected`)?.verdict,
    ).toBe('route-topic-2a-injected')

    expect(
      result.suppressed.some(
        (s) =>
          s.pageUrl === `${ORIGIN}/hidden` &&
          s.verdict === 'suppress-deliberate-exclusion',
      ),
    ).toBe(true)

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/child`)?.verdict,
    ).toBe('report-layout-cascade')

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/draft`)?.verdict,
    ).toBe('indeterminate-generateMetadata')

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/none`)?.verdict,
    ).toMatch(/contradiction/)

    // Never auto-fix
    for (const f of result.findings) {
      expect(f.autoFixable).toBe(false)
    }
  })

  it('expands none case-insensitively', () => {
    expect(expandRobotsDirectives('None').has('noindex')).toBe(true)
    expect(expandRobotsDirectives('None').has('nofollow')).toBe(true)
    expect(
      hasNoindexDirective(
        new Headers(),
        page({ robots: 'none' }),
        'text/html',
      ),
    ).toBe(true)
  })
})

describe('topic 20 — meta vs X-Robots-Tag', () => {
  it('classifies the dossier fixture set', () => {
    const high = detectMetaHeaderDisagree(
      [
        {
          url: `${ORIGIN}/surprise`,
          body: page({ robots: 'index,follow' }),
          headers: new Headers({ 'x-robots-tag': 'noindex' }),
        },
      ],
      {
        headerScopeOverride: {
          kind: 'single-route',
          file: 'next.config.js',
          detail: '/surprise',
        },
      },
    )
    expect(high.findings[0]?.verdict).toBe('finding-header-noindex-surprise')
    expect(high.findings[0]?.severity).toBe('high')

    const low = detectMetaHeaderDisagree(
      [
        {
          url: `${ORIGIN}/strict-meta`,
          body: page({ robots: 'noindex' }),
          headers: new Headers({ 'x-robots-tag': 'index' }),
        },
      ],
      {
        headerScopeOverride: {
          kind: 'single-route',
          file: 'next.config.js',
          detail: '/strict-meta',
        },
      },
    )
    expect(low.findings[0]?.verdict).toBe('finding-meta-stricter')
    expect(low.findings[0]?.severity).toBe('low')

    const same = detectMetaHeaderDisagree([
      {
        url: `${ORIGIN}/same`,
        body: page({ robots: 'noindex, nofollow' }),
        headers: new Headers({ 'x-robots-tag': 'noindex, nofollow' }),
      },
    ])
    expect(same.informational.some((i) => i.pageUrl === `${ORIGIN}/same`)).toBe(
      true,
    )

    const noneEq = detectMetaHeaderDisagree([
      {
        url: `${ORIGIN}/none-eq`,
        body: page({ robots: 'none' }),
        headers: new Headers({ 'x-robots-tag': 'noindex, nofollow' }),
      },
    ])
    expect(
      noneEq.informational.some((i) => i.pageUrl === `${ORIGIN}/none-eq`),
    ).toBe(true)

    const scopes = detectMetaHeaderDisagree([
      {
        url: `${ORIGIN}/scopes`,
        body: `<!doctype html><html><head>
          <meta name="robots" content="index">
          <meta name="googlebot" content="noindex">
        </head><body></body></html>`,
      },
    ])
    expect(
      scopes.suppressed.some(
        (s) => s.verdict === 'suppress-robots-vs-googlebot-scopes',
      ),
    ).toBe(true)

    const wide = detectMetaHeaderDisagree(
      [
        {
          url: `${ORIGIN}/wide`,
          body: page({ robots: 'index' }),
          headers: new Headers({ 'x-robots-tag': 'noindex' }),
        },
      ],
      {
        headerScopeOverride: {
          kind: 'multi-route',
          file: 'next.config.js',
          detail: '/:path*',
        },
      },
    )
    expect(wide.findings[0]?.verdict).toBe('indeterminate-header-scope')
  })
})
