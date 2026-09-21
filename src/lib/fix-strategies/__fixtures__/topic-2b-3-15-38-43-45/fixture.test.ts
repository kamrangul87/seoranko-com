/**
 * Topics 2b, 3, 15, 38, 43, 45 — detect-and-report fixture suite.
 */
import { describe, expect, it } from 'vitest'
import { buildInternalLinkGraph } from '@/lib/fix-strategies/shared'
import { FIX_STRATEGY_PRODUCT_DECISIONS as PD } from '@/lib/fix-strategies/product-decisions'
import {
  detectPotentialSoft404,
  rejectedTextMatchErrorPhrases,
  rejectedClaimSoft404Classifier,
} from '@/lib/fix-strategies/topic-2b'
import {
  detect5xxResponses,
  rejectedRepoFixFor5xx,
  rejectedGscAsCurrentFault,
} from '@/lib/fix-strategies/topic-3'
import {
  detectCanonicalPointsToNoindexed,
  rejectedAutoRemoveNoindex,
} from '@/lib/fix-strategies/topic-15'
import {
  detectStructuredDataContradictsVisible,
  rejectedSpamPolicyAccusation,
  rejectedProseOrSemanticCompare,
} from '@/lib/fix-strategies/topic-38'
import {
  detectOrphanPages,
  rejectedUndiscoverabilityClaim,
  rejectedSitemapAsOrphanFix,
} from '@/lib/fix-strategies/topic-43'
import {
  detectCrawlDepth,
  rejectedGoogleDepthThreshold,
  rejectedDepthPreventsIndexing,
} from '@/lib/fix-strategies/topic-45'

const ORIGIN = 'https://example.com'

describe('topic 2b — potential soft 404', () => {
  it('reports potential soft 404 for structurally empty 200; never claims classifier', () => {
    const r = detectPotentialSoft404({
      pageUrl: `${ORIGIN}/gone`,
      status: 200,
      html: `<!doctype html><html><head><title></title></head><body></body></html>`,
      repoNoindex: 'false',
    })
    expect(
      r.findings.some((f) => f.verdict === 'observation-potential-soft-404'),
    ).toBe(true)
    expect(r.findings[0]!.detail).toMatch(/potential soft 404/i)
    expect(r.findings[0]!.detail.toLowerCase()).not.toMatch(
      /(?<!potential )(?<!google's )soft 404/,
    )
    expect(r.findings[0]!.autoFixable).toBe(false)
  })

  it('suppresses repo-declared noindex and 5xx', () => {
    expect(
      detectPotentialSoft404({
        pageUrl: `${ORIGIN}/x`,
        status: 200,
        html: `<html><body></body></html>`,
        repoNoindex: 'true',
      }).suppressed.some((s) => s.verdict === 'suppress-repo-declared-noindex'),
    ).toBe(true)

    expect(
      detectPotentialSoft404({
        pageUrl: `${ORIGIN}/x`,
        status: 503,
        html: `<html><body></body></html>`,
      }).suppressed.some((s) => s.verdict === 'suppress-availability-5xx'),
    ).toBe(true)
  })

  it('rejects text matching and classifier claims', () => {
    expect(() => rejectedTextMatchErrorPhrases()).toThrow(/rejected/)
    expect(() => rejectedClaimSoft404Classifier()).toThrow(/potential soft 404/)
  })
})

describe('topic 3 — 5xx reproducibility', () => {
  it('classifies stable / transient / historical / timeout / Retry-After', () => {
    // 1. 500 on both → stableAcrossRefetch (not persistent while window unset)
    const r1 = detect5xxResponses({
      pageUrl: `${ORIGIN}/a`,
      attempts: [
        { status: 500, kind: 'http' },
        { status: 500, kind: 'http' },
      ],
    })
    expect(
      r1.findings.some((f) => f.classification === 'stableAcrossRefetch'),
    ).toBe(true)
    // Re-fetch pair alone is not persistent — observedAtMs span required
    expect(r1.findings.some((f) => f.classification === 'persistent-5xx')).toBe(
      false,
    )
    expect(PD.persistent5xxObservationWindowMs).toBe(172_800_000)

    // Persistent when observations span the product window
    const windowMs = PD.persistent5xxObservationWindowMs
    const rPersistent = detect5xxResponses({
      pageUrl: `${ORIGIN}/a-persistent`,
      attempts: [
        { status: 500, kind: 'http', observedAtMs: 1_000_000 },
        {
          status: 500,
          kind: 'http',
          observedAtMs: 1_000_000 + windowMs,
        },
      ],
    })
    expect(
      rPersistent.findings.some((f) => f.classification === 'persistent-5xx'),
    ).toBe(true)

    // 2. 503 then 200 → transient
    const r2 = detect5xxResponses({
      pageUrl: `${ORIGIN}/b`,
      attempts: [
        { status: 503, kind: 'http' },
        { status: 200, kind: 'http' },
      ],
    })
    expect(
      r2.findings.some((f) => f.verdict === 'record-transient'),
    ).toBe(true)

    // 3. Retry-After honoured
    const r3 = detect5xxResponses({
      pageUrl: `${ORIGIN}/c`,
      attempts: [
        {
          status: 503,
          kind: 'http',
          headers: new Headers({ 'retry-after': '2' }),
        },
        { status: 503, kind: 'http' },
      ],
      nowMs: 1_000_000,
    })
    expect(
      r3.findings.some((f) => f.verdict === 'honour-retry-after'),
    ).toBe(true)

    // 4. timeout — not recorded as 500
    const r4 = detect5xxResponses({
      pageUrl: `${ORIGIN}/d`,
      attempts: [
        { status: null, kind: 'timeout' },
        { status: null, kind: 'timeout' },
      ],
    })
    expect(r4.findings.some((f) => f.classification === 'timeout')).toBe(true)
    expect(r4.findings[0]!.detail).toMatch(/timeout/i)
    expect(r4.findings[0]!.classification).not.toBe('stableAcrossRefetch')

    // Historical GSC
    const r5 = detect5xxResponses({
      pageUrl: `${ORIGIN}/e`,
      attempts: [{ status: 200, kind: 'http' }],
      gscServerErrorCrawlDate: '2026-09-01',
      liveStatus: 200,
    })
    expect(
      r5.findings.some((f) => f.verdict === 'report-historical-gsc'),
    ).toBe(true)
    expect(r5.findings[0]!.gscCrawlDate).toBe('2026-09-01')
    expect(r5.findings[0]!.detail).toMatch(/not a current fault/)

    // Single observation suppressed
    expect(
      detect5xxResponses({
        pageUrl: `${ORIGIN}/f`,
        attempts: [{ status: 500, kind: 'http' }],
      }).suppressed.some((s) => s.verdict === 'suppress-single-observation'),
    ).toBe(true)
  })

  it('rejects repo fix and GSC-as-current', () => {
    expect(() => rejectedRepoFixFor5xx()).toThrow(/no deterministic/)
    expect(() => rejectedGscAsCurrentFault()).toThrow(/historical/)
  })
})

describe('topic 15 — canonical to noindexed', () => {
  const pageHtml = (canonical: string) =>
    `<!doctype html><html><head><link rel="canonical" href="${canonical}" /><title>T</title></head><body><p>Hi</p></body></html>`
  const noindexHtml = `<!doctype html><html><head><meta name="robots" content="noindex" /><title>T</title></head><body><p>Excluded</p></body></html>`
  const indexHtml = `<!doctype html><html><head><title>T</title></head><body><p>Ok</p></body></html>`

  it('classifies dossier fixtures', () => {
    // 1. repo-declared → human-review
    const r1 = detectCanonicalPointsToNoindexed({
      pageUrl: `${ORIGIN}/a`,
      html: pageHtml(`${ORIGIN}/secret`),
      target: {
        url: `${ORIGIN}/secret`,
        status: 200,
        html: noindexHtml,
        repoNoindex: 'true',
      },
    })
    expect(
      r1.findings.some(
        (f) => f.verdict === 'human-review-repo-noindex-contradiction',
      ),
    ).toBe(true)
    expect(r1.findings[0]!.autoFixable).toBe(false)
    expect(r1.findings[0]!.proposals.length).toBe(2)

    // 2. injected → topic 14
    const r2 = detectCanonicalPointsToNoindexed({
      pageUrl: `${ORIGIN}/a`,
      html: pageHtml(`${ORIGIN}/soft`),
      target: {
        url: `${ORIGIN}/soft`,
        status: 200,
        html: noindexHtml,
        repoNoindex: 'false',
      },
    })
    expect(
      r2.findings.some((f) => f.verdict === 'route-topic-14-injected'),
    ).toBe(true)

    // 3. layout cascade source
    const r3 = detectCanonicalPointsToNoindexed({
      pageUrl: `${ORIGIN}/a`,
      html: pageHtml(`${ORIGIN}/child`),
      target: {
        url: `${ORIGIN}/child`,
        status: 200,
        html: noindexHtml,
        repoNoindex: 'true',
        noindexCascadeSource: 'app/(marketing)/layout.tsx',
      },
    })
    expect(
      r3.findings.some((f) => f.verdict === 'report-layout-cascade-source'),
    ).toBe(true)
    expect(r3.findings[0]!.cascadeSource).toMatch(/layout/)

    // 4. header/meta disagree → topic 20
    const r4 = detectCanonicalPointsToNoindexed({
      pageUrl: `${ORIGIN}/a`,
      html: pageHtml(`${ORIGIN}/conflict`),
      target: {
        url: `${ORIGIN}/conflict`,
        status: 200,
        html: `<html><head><meta name="robots" content="index,follow" /></head><body></body></html>`,
        headers: new Headers({ 'x-robots-tag': 'noindex' }),
        repoNoindex: 'true',
      },
    })
    expect(
      r4.findings.some((f) => f.verdict === 'route-topic-20-directive-conflict'),
    ).toBe(true)

    // 5. healthy → suppress
    const r5 = detectCanonicalPointsToNoindexed({
      pageUrl: `${ORIGIN}/a`,
      html: pageHtml(`${ORIGIN}/ok`),
      target: {
        url: `${ORIGIN}/ok`,
        status: 200,
        html: indexHtml,
        repoNoindex: 'false',
      },
    })
    expect(
      r5.suppressed.some((s) => s.verdict === 'suppress-healthy-target'),
    ).toBe(true)
  })

  it('rejects auto-remove noindex', () => {
    expect(() => rejectedAutoRemoveNoindex()).toThrow(/never auto-remove/)
  })
})

describe('topic 38 — structured vs structured (38a) / observation (38b)', () => {
  function page(jsonLd: object, body = '<p>Hi</p>') {
    return `<!doctype html><html><head><title>T</title><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body>${body}</body></html>`
  }

  it('classifies 38a fixtures; 38b observation only', () => {
    const now = Date.parse('2026-09-17T00:00:00Z')

    // 1. dateModified before datePublished
    expect(
      detectStructuredDataContradictsVisible({
        html: page({
          '@context': 'https://schema.org',
          '@type': 'Article',
          datePublished: '2026-09-10',
          dateModified: '2026-09-01',
        }),
        pageUrl: ORIGIN,
        nowMs: now,
      }).findings.some((f) => f.verdict === 'human-review-date-ordering'),
    ).toBe(true)

    // 2. future datePublished
    expect(
      detectStructuredDataContradictsVisible({
        html: page({
          '@context': 'https://schema.org',
          '@type': 'Article',
          datePublished: '2027-01-01',
        }),
        pageUrl: ORIGIN,
        nowMs: now,
      }).findings.some((f) => f.verdict === 'human-review-future-datePublished'),
    ).toBe(true)

    // 3. aggregateRating reviewCount 0
    expect(
      detectStructuredDataContradictsVisible({
        html: page({
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'X',
          aggregateRating: { ratingValue: 5, reviewCount: 0, bestRating: 5 },
        }),
        pageUrl: ORIGIN,
        nowMs: now,
      }).findings.some((f) => f.verdict === 'human-review-rating-inconsistent'),
    ).toBe(true)

    // 4. entity url → human-review (both values shown; never auto-fix)
    const r4 = detectStructuredDataContradictsVisible({
      html: page({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        url: 'https://other.example/',
      }),
      pageUrl: ORIGIN,
      nowMs: now,
    })
    const entity = r4.findings.find(
      (f) => f.verdict === 'human-review-entity-url-mismatch',
    )
    expect(entity).toBeTruthy()
    expect(entity!.autoFixable).toBe(false)
    expect(entity!.proposedEntityUrl).toBeNull()
    expect(entity!.values).toEqual({
      left: 'https://other.example/',
      right: ORIGIN + '/',
    })
    expect(entity!.detail).toMatch(/other\.example/)
    expect(entity!.detail).toMatch(ORIGIN)

    // 5. format-only date diff → nothing
    const r5 = detectStructuredDataContradictsVisible({
      html: page(
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          datePublished: '2026-09-10T00:00:00.000Z',
        },
        '<time datetime="2026-09-10">10 Sep 2026</time>',
      ),
      pageUrl: ORIGIN,
      nowMs: now,
    })
    expect(
      r5.suppressed.some((s) => s.verdict === 'suppress-format-only-date-diff'),
    ).toBe(true)
    expect(
      r5.findings.some((f) => f.verdict === 'human-review-structured-vs-structured'),
    ).toBe(false)

    // 6. actual date value differ → human-review
    expect(
      detectStructuredDataContradictsVisible({
        html: page(
          {
            '@context': 'https://schema.org',
            '@type': 'Article',
            datePublished: '2026-09-10',
          },
          '<time datetime="2026-01-01">1 Jan</time>',
        ),
        pageUrl: ORIGIN,
        nowMs: now,
      }).findings.some(
        (f) => f.verdict === 'human-review-structured-vs-structured',
      ),
    ).toBe(true)

    // 7. paywalled → suppress
    expect(
      detectStructuredDataContradictsVisible({
        html: page({
          '@context': 'https://schema.org',
          '@type': 'Article',
          isAccessibleForFree: false,
        }),
        pageUrl: ORIGIN,
        paywalledContentMarkup: true,
        nowMs: now,
      }).suppressed.some((s) => s.verdict === 'suppress-paywalled-permitted'),
    ).toBe(true)

    // 8. 38b observation only — never policy violation
    const r8 = detectStructuredDataContradictsVisible({
      html: page({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Unrelated',
      }),
      pageUrl: ORIGIN,
      observation38b: {
        detail: 'the marked-up subject appears unrelated to visible content',
        method: 'human observation / not mechanically provable',
      },
      nowMs: now,
    })
    expect(r8.observations.some((o) => o.verdict === 'observation-38b')).toBe(
      true,
    )
    expect(r8.observations[0]!.detail).toMatch(/Not a spam-policy violation/)
    expect(r8.observations[0]!.detail).not.toMatch(/violates.*spam/i)
  })

  it('rejects spam accusation and prose compare', () => {
    expect(() => rejectedSpamPolicyAccusation()).toThrow(/D23/)
    expect(() => rejectedProseOrSemanticCompare()).toThrow(/structured values/)
  })
})

describe('topics 43 + 45 — link graph / depth / client_only', () => {
  function htmlWithLinks(
    links: Array<string | { href?: string; onclick?: boolean; js?: boolean }>,
  ): string {
    const as = links
      .map((l) => {
        if (typeof l === 'string') {
          return `<a href="${l}">x</a>`
        }
        if (l.js) return `<a href="javascript:go('${l.href}')">x</a>`
        if (l.onclick) return `<a onclick="location='${l.href}'">x</a>`
        return `<a href="${l.href}">x</a>`
      })
      .join('')
    return `<!doctype html><html><head><title>T</title></head><body>${as}<p>Content</p></body></html>`
  }

  it('topic 43 dossier fixtures', () => {
    const home = ORIGIN + '/'
    const orphan = ORIGIN + '/orphan'
    const linked = ORIGIN + '/linked'
    const onclickOnly = ORIGIN + '/onclick-only'
    const jsRendered = ORIGIN + '/js-rendered'
    const campaign = ORIGIN + '/campaign'

    // Basic graph: home → linked; orphan unlinked; homepage; noindex orphan
    const graph = buildInternalLinkGraph({
      originUrl: ORIGIN,
      homepageUrl: home,
      pages: [
        { url: home, html: htmlWithLinks([linked]), status: 200 },
        { url: linked, html: htmlWithLinks([home]), status: 200 },
        { url: orphan, html: htmlWithLinks([]), status: 200 },
        {
          url: ORIGIN + '/orphan-sm',
          html: htmlWithLinks([]),
          status: 200,
          inSitemap: true,
        },
        {
          url: ORIGIN + '/noindex-orphan',
          html: htmlWithLinks([]),
          status: 200,
          hasNoindex: true,
        },
        {
          url: campaign,
          html: htmlWithLinks([]),
          status: 200,
          campaignLanding: true,
        },
      ],
      renderedEdges: [{ fromUrl: home, toUrl: jsRendered }],
    })

    // Ensure js-rendered page exists as node
    const r = detectOrphanPages({
      graph,
      nonCrawlableInbound: [{ targetUrl: onclickOnly, kind: 'onclick' }],
    })
    // Add onclick-only node manually via rebuild including the page
    const graph2 = buildInternalLinkGraph({
      originUrl: ORIGIN,
      homepageUrl: home,
      pages: [
        ...graph.nodes
          .filter((n) => n.urlNormalized !== onclickOnly)
          .map((n) => ({
            url: n.urlNormalized,
            html:
              n.urlNormalized === home
                ? htmlWithLinks([linked])
                : htmlWithLinks([]),
            status: n.status,
            hasNoindex: n.hasNoindex,
            campaignLanding: n.campaignLanding,
            inSitemap: n.inSitemap,
          })),
        { url: onclickOnly, html: htmlWithLinks([]), status: 200 },
        { url: jsRendered, html: htmlWithLinks([]), status: 200 },
      ],
      renderedEdges: [{ fromUrl: home, toUrl: jsRendered }],
    })
    const r43 = detectOrphanPages({
      graph: graph2,
      nonCrawlableInbound: [{ targetUrl: onclickOnly, kind: 'onclick' }],
    })

    expect(
      r43.findings.some(
        (f) =>
          f.verdict === 'finding-link-graph-orphan' && f.pageUrl === orphan,
      ),
    ).toBe(true)
    expect(
      r43.findings.some(
        (f) => f.verdict === 'finding-orphan-in-sitemap-lower',
      ),
    ).toBe(true)
    expect(
      r43.findings.some((f) => f.verdict === 'finding-orphan-onclick-only'),
    ).toBe(true)
    expect(
      r43.suppressed.some((s) => s.verdict === 'suppress-js-rendered-inbound'),
    ).toBe(true)
    expect(
      r43.suppressed.some((s) => s.verdict === 'suppress-homepage'),
    ).toBe(true)
    expect(
      r43.suppressed.some((s) => s.verdict === 'suppress-non-indexable'),
    ).toBe(true)
    expect(
      r43.findings.some((f) => f.verdict === 'human-review-campaign-landing'),
    ).toBe(true)
    for (const f of r43.findings) {
      // May mention the unsupported claim only to deny it — never assert it.
      expect(f.detail).not.toMatch(
        /Google cannot discover this page|Google cannot index this page/i,
      )
      expect(f.detail).toMatch(/link graph|orphaned|orphan/i)
    }
    void r
  })

  it('topic 45 reports depth + path; no severity; orphans → 43', () => {
    const home = ORIGIN + '/'
    // home → a → b → c → d → e → f → g (depth 7)
    const chain = ['/a', '/b', '/c', '/d', '/e', '/f', '/g'].map(
      (p) => ORIGIN + p,
    )
    const pages = [
      {
        url: home,
        html: htmlWithLinks([chain[0]!]),
        status: 200,
      },
      ...chain.map((url, i) => ({
        url,
        html: htmlWithLinks([i + 1 < chain.length ? chain[i + 1]! : home]),
        status: 200,
      })),
      {
        url: ORIGIN + '/orphan-depth',
        html: htmlWithLinks([]),
        status: 200,
      },
      {
        url: ORIGIN + '/paginated',
        html: htmlWithLinks([]),
        status: 200,
      },
    ]
    // Connect paginated via long chain for pattern label — just give it depth 2
    pages[0]!.html = htmlWithLinks([chain[0]!, ORIGIN + '/p1'])
    pages.push({
      url: ORIGIN + '/p1',
      html: htmlWithLinks([ORIGIN + '/paginated']),
      status: 200,
    })

    // render-deep page
    const graph3 = buildInternalLinkGraph({
      originUrl: ORIGIN,
      homepageUrl: home,
      pages: [
        ...pages,
        { url: ORIGIN + '/render-deep', html: htmlWithLinks([]), status: 200 },
        {
          url: ORIGIN + '/onclick-depth',
          html: htmlWithLinks([{ onclick: true, href: '/x' }]),
          status: 200,
        },
      ],
      renderedEdges: [{ fromUrl: home, toUrl: ORIGIN + '/render-deep' }],
    })

    const r45 = detectCrawlDepth({
      graph: graph3,
      paginationPatternUrls: [ORIGIN + '/paginated'],
    })

    const depth2 = r45.metrics.find((m) => m.pageUrl === chain[1])
    expect(depth2?.depth).toBe(2)
    expect(depth2?.severity).toBeNull()
    expect(depth2?.shortestPath?.[0]).toBe(home)

    const depth7 = r45.metrics.find((m) => m.pageUrl === chain[6])
    expect(depth7?.depth).toBe(7)
    expect(depth7?.severity).toBeNull()
    expect(depth7?.detail).toMatch(/Shortest path/)
    expect(depth7?.detail).not.toMatch(/too deep|may not be indexed/i)

    expect(
      r45.findings.some(
        (f) =>
          f.verdict === 'route-topic-43-depth-undefined' &&
          f.pageUrl === ORIGIN + '/orphan-depth',
      ),
    ).toBe(true)

    expect(
      r45.metrics.some((m) => m.verdict === 'metric-pagination-pattern'),
    ).toBe(true)

    const rendered = r45.metrics.find(
      (m) => m.pageUrl === ORIGIN + '/render-deep',
    )
    expect(rendered?.renderRequired).toBe(true)

    expect(
      r45.suppressed.some(
        (s) => s.verdict === 'suppress-non-crawlable-does-not-reduce-depth',
      ),
    ).toBe(true)

    expect(PD.clickDepthReportingThreshold).toBeNull()
  })

  it('client_only graph reported for 43 and 45 — no false orphans', () => {
    const home = ORIGIN + '/'
    const graph = buildInternalLinkGraph({
      originUrl: ORIGIN,
      homepageUrl: home,
      pages: [
        {
          url: home,
          // SPA shell — no crawlable <a href>
          html: `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`,
          status: 200,
        },
        {
          url: ORIGIN + '/about',
          html: `<html><body><div id="root"></div></body></html>`,
          status: 200,
        },
      ],
    })
    expect(graph.clientOnlyGraph).toBe(true)
    expect(graph.graphPresence).toBe('client_only')

    const r43 = detectOrphanPages({ graph })
    expect(
      r43.findings.some((f) => f.verdict === 'report-client-only-graph'),
    ).toBe(true)
    expect(
      r43.findings.some((f) => f.verdict === 'finding-link-graph-orphan'),
    ).toBe(false)

    const r45 = detectCrawlDepth({ graph })
    expect(
      r45.findings.some((f) => f.verdict === 'report-client-only-graph'),
    ).toBe(true)
  })

  it('partial client_only pages → client_only-limited, not orphans', () => {
    const home = ORIGIN + '/'
    const blog = ORIGIN + '/blog'
    const orphan = ORIGIN + '/lonely'
    const graph = buildInternalLinkGraph({
      originUrl: ORIGIN,
      homepageUrl: home,
      pages: [
        {
          url: home,
          html: '', // client_only shell — no served links
          status: 200,
        },
        {
          url: blog,
          html: `<html><body><a href="${orphan}">lonely</a></body></html>`,
          status: 200,
        },
        {
          url: orphan,
          html: `<html><body><p>page</p></body></html>`,
          status: 200,
        },
      ],
    })
    // Graph has crawlable edges from blog — not sitewide clientOnlyGraph
    expect(graph.clientOnlyGraph).toBe(false)

    const withoutGuard = detectOrphanPages({ graph })
    // Without the guard, pages with zero inbound would raise (homepage excluded)
    expect(
      withoutGuard.findings.some((f) =>
        f.verdict.startsWith('finding-'),
      ),
    ).toBe(true)

    const withGuard = detectOrphanPages({
      graph,
      hasClientOnlyPages: true,
    })
    expect(
      withGuard.findings.some((f) => f.verdict === 'client_only-limited'),
    ).toBe(true)
    expect(
      withGuard.findings.some((f) => f.verdict.startsWith('finding-')),
    ).toBe(false)
  })

  it('rejects unsupported wording helpers', () => {
    expect(() => rejectedUndiscoverabilityClaim()).toThrow(/link-graph orphan/)
    expect(() => rejectedSitemapAsOrphanFix()).toThrow(/N9/)
    expect(() => rejectedGoogleDepthThreshold()).toThrow(/N10/)
    expect(() => rejectedDepthPreventsIndexing()).toThrow(/de-indexing/)
  })
})
