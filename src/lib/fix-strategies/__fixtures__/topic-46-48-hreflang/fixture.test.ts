/**
 * Topics 46 / 47 / 48 — hreflang fixture suite.
 *
 * ONE collector feeds all three. Annotations from HTML, HTTP Link, and
 * sitemap are equal (G1).
 */
import { describe, expect, it } from 'vitest'
import {
  collectHreflangAnnotations,
  validateGoogleHreflangCode,
  HREFLANG_ISO_SNAPSHOT_META,
  isValidBcp47,
  buildSitemapInspection,
  documentFromBody,
  robotsInspectionFromBody,
  SITEMAP_NAMESPACE,
  parseSitemapXml,
} from '@/lib/fix-strategies/shared'
import {
  detectMissingReturnLinks,
  rejectedGuessLocaleToCompleteCluster,
  rejectedSiteWideFromOnePair,
} from '@/lib/fix-strategies/topic-46'
import {
  detectInvalidLanguageRegionCodes,
  rejectedReuseTopic34Bcp47,
  rejectedAutoReplaceEs419,
} from '@/lib/fix-strategies/topic-47'
import {
  detectAlternateTargetNotIndexable,
  rejectedRaiseOnXDefaultRedirect,
  rejectedPartialLocaleRemoval,
  absolutizeAlternateHref,
} from '@/lib/fix-strategies/topic-48'

const ORIGIN = 'https://example.com'
const EN = `${ORIGIN}/en`
const DE = `${ORIGIN}/de`
const FR = `${ORIGIN}/fr`

function htmlPage(
  urlPath: string,
  alternates: Array<{ lang: string; href: string }>,
  opts?: { canonical?: string; noindex?: boolean; inBody?: boolean },
): string {
  const links = alternates
    .map(
      (a) =>
        `<link rel="alternate" hreflang="${a.lang}" href="${a.href}" />`,
    )
    .join('')
  const canonical = opts?.canonical
    ? `<link rel="canonical" href="${opts.canonical}" />`
    : `<link rel="canonical" href="${ORIGIN}${urlPath}" />`
  const robots = opts?.noindex
    ? `<meta name="robots" content="noindex" />`
    : ''
  if (opts?.inBody) {
    return `<!doctype html><html><head><title>T</title>${canonical}${robots}</head><body>${links}<h1>Hi</h1></body></html>`
  }
  return `<!doctype html><html><head><title>T</title>${canonical}${robots}${links}</head><body><h1>Hi</h1></body></html>`
}

function sitemapWithHreflang(
  entries: Array<{
    loc: string
    links: Array<{ lang: string; href: string }>
  }>,
): string {
  const urls = entries
    .map((e) => {
      const links = e.links
        .map(
          (l) =>
            `<xhtml:link rel="alternate" hreflang="${l.lang}" href="${l.href}" />`,
        )
        .join('')
      return `<url><loc>${e.loc}</loc>${links}</url>`
    })
    .join('')
  return `<?xml version="1.0"?>
<urlset xmlns="${SITEMAP_NAMESPACE}"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`
}

function headersWithLink(parts: string[]): Headers {
  return new Headers({ Link: parts.join(', ') })
}

describe('ONE hreflang annotation collector (G1)', () => {
  it('reads HTML, HTTP Link, and sitemap equally', () => {
    const sitemapXml = sitemapWithHreflang([
      {
        loc: EN,
        links: [
          { lang: 'en', href: EN },
          { lang: 'de', href: DE },
        ],
      },
      {
        loc: DE,
        links: [
          { lang: 'en', href: EN },
          { lang: 'de', href: DE },
        ],
      },
    ])
    const sitemap = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap.xml\n`),
      documents: [documentFromBody(`${ORIGIN}/sitemap.xml`, sitemapXml)],
    })

    const insp = collectHreflangAnnotations({
      originUrl: ORIGIN,
      sitemap,
      pages: [
        {
          url: EN,
          html: htmlPage('/en', [{ lang: 'en', href: EN }]),
          headers: headersWithLink([
            `<${FR}>; rel="alternate"; hreflang="fr"`,
          ]),
          status: 200,
        },
        {
          url: DE,
          html: htmlPage('/de', []),
          status: 200,
        },
      ],
    })

    const en = insp.pageByNormalizedUrl.get(EN)!
    expect(en.htmlAnnotations.some((a) => a.hreflangRaw === 'en')).toBe(true)
    expect(en.headerAnnotations.some((a) => a.hreflangRaw === 'fr')).toBe(true)
    expect(en.sitemapAnnotations.some((a) => a.hreflangRaw === 'de')).toBe(true)
    expect(en.effectiveAnnotations.length).toBeGreaterThanOrEqual(3)

    // Same inspection feeds all three topics
    detectMissingReturnLinks({ inspection: insp })
    detectInvalidLanguageRegionCodes({ inspection: insp })
    detectAlternateTargetNotIndexable({ inspection: insp })
  })

  it('parses xhtml:link from sitemap url blocks', () => {
    const xml = sitemapWithHreflang([
      {
        loc: EN,
        links: [
          { lang: 'en', href: EN },
          { lang: 'de', href: DE },
        ],
      },
    ])
    const parsed = parseSitemapXml(xml)
    expect(parsed.urlEntries[0]!.hreflangLinks).toHaveLength(2)
    expect(parsed.urlEntries[0]!.hreflangLinks[1]!.hreflang).toBe('de')
  })
})

describe('topic 46 — missing return links', () => {
  it('classifies the dossier fixture set', () => {
    // 1. A→B with no B→A → raised
    const r1 = detectMissingReturnLinks({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
            ]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage('/de', [{ lang: 'de', href: DE }]),
            status: 200,
          },
        ],
      },
    })
    expect(
      r1.findings.some((f) => f.verdict === 'finding-missing-return'),
    ).toBe(true)
    expect(
      r1.findings.filter((f) => f.verdict === 'finding-missing-return'),
    ).toHaveLength(1)

    // 2. A→B with B→A only in sitemap → suppressed (G1)
    const sm = sitemapWithHreflang([
      {
        loc: DE,
        links: [
          { lang: 'de', href: DE },
          { lang: 'en', href: EN },
        ],
      },
    ])
    const r2 = detectMissingReturnLinks({
      collect: {
        originUrl: ORIGIN,
        sitemap: buildSitemapInspection({
          originUrl: ORIGIN,
          robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap.xml\n`),
          documents: [documentFromBody(`${ORIGIN}/sitemap.xml`, sm)],
        }),
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
            ]),
            status: 200,
          },
          {
            url: DE,
            // HTML has no return — sitemap does
            html: htmlPage('/de', [{ lang: 'de', href: DE }]),
            status: 200,
          },
        ],
      },
    })
    expect(
      r2.findings.some((f) => f.verdict === 'finding-missing-return'),
    ).toBe(false)
    expect(
      r2.suppressed.some(
        (s) => s.verdict === 'suppress-reciprocal-via-other-method',
      ),
    ).toBe(true)

    // 3. missing self-reference → raised
    const r3 = detectMissingReturnLinks({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [{ lang: 'de', href: DE }]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage('/de', [
              { lang: 'de', href: DE },
              { lang: 'en', href: EN },
            ]),
            status: 200,
          },
        ],
      },
    })
    expect(
      r3.findings.some((f) => f.verdict === 'finding-missing-self-reference'),
    ).toBe(true)

    // 4. hub pattern — every declared pair reciprocal, not all-to-all → suppress
    const r4 = detectMissingReturnLinks({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
              { lang: 'fr', href: FR },
            ]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage('/de', [
              { lang: 'de', href: DE },
              { lang: 'en', href: EN },
              // no FR — hub
            ]),
            status: 200,
          },
          {
            url: FR,
            html: htmlPage('/fr', [
              { lang: 'fr', href: FR },
              { lang: 'en', href: EN },
              // no DE — hub
            ]),
            status: 200,
          },
        ],
      },
    })
    expect(
      r4.findings.some((f) => f.verdict === 'finding-missing-return'),
    ).toBe(false)
    expect(
      r4.suppressed.some((s) => s.verdict === 'suppress-hub-pattern-permitted'),
    ).toBe(true)

    // 5. A→B where B→A points at a different URL → raised
    const EN_ALT = `${ORIGIN}/en-alt`
    const r5 = detectMissingReturnLinks({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
            ]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage('/de', [
              { lang: 'de', href: DE },
              { lang: 'en', href: EN_ALT },
            ]),
            status: 200,
          },
          {
            url: EN_ALT,
            html: htmlPage('/en-alt', [{ lang: 'en', href: EN_ALT }]),
            status: 200,
          },
        ],
      },
    })
    expect(
      r5.findings.some(
        (f) => f.verdict === 'finding-conflicting-return-target',
      ),
    ).toBe(true)

    // 6. cross-domain → human-review
    const r6 = detectMissingReturnLinks({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: 'https://other.example/de' },
            ]),
            status: 200,
          },
        ],
      },
    })
    expect(
      r6.findings.some((f) => f.verdict === 'human-review-cross-domain'),
    ).toBe(true)

    // 7. annotation in <body> → topic 29
    const r7 = detectMissingReturnLinks({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage(
              '/en',
              [
                { lang: 'en', href: EN },
                { lang: 'de', href: DE },
              ],
              { inBody: true },
            ),
            status: 200,
          },
        ],
      },
    })
    expect(
      r7.findings.some((f) => f.verdict === 'route-topic-29-body-annotation'),
    ).toBe(true)
  })

  it('rejects guessing locale and site-wide reporting', () => {
    expect(() => rejectedGuessLocaleToCompleteCluster()).toThrow(/never guess/)
    expect(() => rejectedSiteWideFromOnePair()).toThrow(/per pair/)
  })
})

describe('topic 47 — invalid language/region codes', () => {
  it('does not share topic 34 BCP 47 (es-419 / en-UK pass BCP47, fail Google)', () => {
    expect(isValidBcp47('es-419')).toBe(true)
    expect(isValidBcp47('en-UK')).toBe(true)
    expect(validateGoogleHreflangCode('es-419').ok).toBe(false)
    expect(validateGoogleHreflangCode('en-UK').ok).toBe(false)
    expect(validateGoogleHreflangCode('zh-Hans-US').ok).toBe(true)
    expect(() => rejectedReuseTopic34Bcp47()).toThrow(/must not reuse/)
  })

  it('classifies the dossier fixture set', () => {
    const pageWith = (lang: string, href = EN) =>
      detectInvalidLanguageRegionCodes({
        collect: {
          originUrl: ORIGIN,
          pages: [
            {
              url: EN,
              html: htmlPage('/en', [{ lang, href }]),
              status: 200,
            },
          ],
        },
      })

    // 1. hreflang="US" → human-review
    expect(
      pageWith('US').findings.some(
        (f) => f.verdict === 'human-review-region-only',
      ),
    ).toBe(true)

    // 2. en-UK → auto-fix en-GB
    const r2 = pageWith('en-UK')
    expect(
      r2.findings.some((f) => f.verdict === 'auto-fix-en-uk-to-en-gb'),
    ).toBe(true)
    expect(
      r2.findings.find((f) => f.verdict === 'auto-fix-en-uk-to-en-gb')
        ?.normalized,
    ).toBe('en-GB')

    // 3. es-419 → human-review
    expect(
      pageWith('es-419').findings.some(
        (f) => f.verdict === 'human-review-es-419',
      ),
    ).toBe(true)
    expect(() => rejectedAutoReplaceEs419()).toThrow(/business decision/)

    // 4. US-en → auto inverted
    const r4 = pageWith('US-en')
    expect(
      r4.findings.some((f) => f.verdict === 'auto-fix-inverted-order'),
    ).toBe(true)
    expect(
      r4.findings.find((f) => f.verdict === 'auto-fix-inverted-order')
        ?.normalized,
    ).toBe('en-US')

    // 5. zh-Hans-US → nothing (accepted)
    const r5 = pageWith('zh-Hans-US')
    expect(r5.findings.filter((f) => f.severity === 'high')).toHaveLength(0)
    expect(
      r5.suppressed.some((s) => s.verdict === 'suppress-valid-script-region'),
    ).toBe(true)

    // 6. x-default alone → nothing
    const r6 = pageWith('x-default')
    expect(
      r6.findings.some((f) => f.verdict !== 'auto-fix-case-convention'),
    ).toBe(false)
    expect(
      r6.suppressed.some((s) => s.verdict === 'suppress-x-default-ok'),
    ).toBe(true)

    // 7. x-default with language → auto strip
    expect(
      pageWith('x-default-en').findings.some(
        (f) => f.verdict === 'auto-fix-x-default-strip-language',
      ),
    ).toBe(true)

    // 8. en-gb → auto case convention
    expect(
      pageWith('en-gb').findings.some(
        (f) => f.verdict === 'auto-fix-case-convention',
      ),
    ).toBe(true)

    // 9. two de with different targets → human-review
    const r9 = detectInvalidLanguageRegionCodes({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'de', href: DE },
              { lang: 'de', href: FR },
            ]),
            status: 200,
          },
        ],
      },
    })
    expect(
      r9.findings.some(
        (f) => f.verdict === 'human-review-duplicate-conflicting',
      ),
    ).toBe(true)

    // 10. no x-default anywhere → nothing
    const r10 = pageWith('en')
    expect(
      r10.suppressed.some((s) => s.verdict === 'suppress-x-default-absent'),
    ).toBe(true)
    expect(
      r10.findings.some((f) =>
        String(f.verdict).includes('x-default'),
      ),
    ).toBe(false)
  })

  it('undated ISO tables cannot support a finding', () => {
    const r = detectInvalidLanguageRegionCodes({
      isoMeta: { ...HREFLANG_ISO_SNAPSHOT_META, verifiedOn: '' },
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [{ lang: 'en-UK', href: EN }]),
            status: 200,
          },
        ],
      },
    })
    expect(r.findings).toHaveLength(0)
    expect(
      r.suppressed.some((s) => s.verdict === 'suppress-undated-tables'),
    ).toBe(true)
  })
})

describe('topic 48 — alternate target not indexable', () => {
  it('classifies the dossier fixture set', () => {
    // 1. confirmed 404 → human-review atomic removal
    const r1 = detectAlternateTargetNotIndexable({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
            ]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage('/de', [
              { lang: 'de', href: DE },
              { lang: 'en', href: EN },
            ]),
            status: 404,
          },
        ],
      },
    })
    const rem = r1.findings.find(
      (f) => f.verdict === 'human-review-atomic-locale-removal',
    )
    expect(rem).toBeTruthy()
    expect(rem!.atomicClusterUrls!.length).toBeGreaterThanOrEqual(2)

    // 2. relative alternate → auto absolutize
    const r2 = detectAlternateTargetNotIndexable({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: '/de' },
            ]),
            status: 200,
          },
        ],
      },
    })
    expect(
      r2.findings.some((f) => f.verdict === 'auto-fix-absolutize-relative'),
    ).toBe(true)
    expect(absolutizeAlternateHref('/de', EN)).toBe(DE)

    // 3. single-hop redirect → auto repoint
    const r3 = detectAlternateTargetNotIndexable({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
            ]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage('/de', [
              { lang: 'de', href: DE },
              { lang: 'en', href: EN },
            ]),
            status: 200,
            redirectHopCount: 1,
            finalUrl: `${ORIGIN}/de/`,
          },
        ],
      },
    })
    expect(
      r3.findings.some((f) => f.verdict === 'auto-fix-repoint-redirect'),
    ).toBe(true)

    // 4. repo-declared noindex → human-review
    const r4 = detectAlternateTargetNotIndexable({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
            ]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage('/de', [
              { lang: 'de', href: DE },
              { lang: 'en', href: EN },
            ]),
            status: 200,
            repoDeclaredNoindex: true,
          },
        ],
      },
    })
    expect(
      r4.findings.some((f) => f.verdict === 'human-review-repo-noindex'),
    ).toBe(true)

    // 5. x-default → redirecting homepage → NOTHING (G18)
    const r5 = detectAlternateTargetNotIndexable({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'x-default', href: ORIGIN + '/' },
            ]),
            status: 200,
          },
          {
            url: ORIGIN + '/',
            html: htmlPage('/', [{ lang: 'x-default', href: ORIGIN + '/' }]),
            status: 200,
            redirectHopCount: 1,
            finalUrl: EN,
          },
        ],
      },
    })
    expect(
      r5.findings.some((f) =>
        f.locale?.toLowerCase() === 'x-default' ||
        f.verdict === 'auto-fix-repoint-redirect',
      ),
    ).toBe(false)
    expect(
      r5.suppressed.some(
        (s) => s.verdict === 'suppress-x-default-redirecting-homepage',
      ),
    ).toBe(true)
    expect(() => rejectedRaiseOnXDefaultRedirect()).toThrow(/G18/)

    // 6. alternate canonicalises to English → human-review G22
    const r6 = detectAlternateTargetNotIndexable({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
            ]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage(
              '/de',
              [
                { lang: 'de', href: DE },
                { lang: 'en', href: EN },
              ],
              { canonical: EN },
            ),
            status: 200,
          },
        ],
      },
    })
    expect(
      r6.findings.some(
        (f) => f.verdict === 'human-review-cross-locale-canonical',
      ),
    ).toBe(true)

    // 7. disallowed for Googlebot → human-review
    const r7 = detectAlternateTargetNotIndexable({
      collect: {
        originUrl: ORIGIN,
        pages: [
          {
            url: EN,
            html: htmlPage('/en', [
              { lang: 'en', href: EN },
              { lang: 'de', href: DE },
            ]),
            status: 200,
          },
          {
            url: DE,
            html: htmlPage('/de', [
              { lang: 'de', href: DE },
              { lang: 'en', href: EN },
            ]),
            status: 200,
            robotsDisallowedGooglebot: true,
          },
        ],
      },
    })
    expect(
      r7.findings.some((f) => f.verdict === 'human-review-robots-disallowed'),
    ).toBe(true)

    // 8. sitemap-only healthy → nothing
    const sm = sitemapWithHreflang([
      {
        loc: EN,
        links: [
          { lang: 'en', href: EN },
          { lang: 'de', href: DE },
        ],
      },
      {
        loc: DE,
        links: [
          { lang: 'de', href: DE },
          { lang: 'en', href: EN },
        ],
      },
    ])
    const r8 = detectAlternateTargetNotIndexable({
      collect: {
        originUrl: ORIGIN,
        sitemap: buildSitemapInspection({
          originUrl: ORIGIN,
          robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap.xml\n`),
          documents: [documentFromBody(`${ORIGIN}/sitemap.xml`, sm)],
        }),
        pages: [
          { url: EN, html: htmlPage('/en', []), status: 200 },
          { url: DE, html: htmlPage('/de', []), status: 200 },
        ],
      },
    })
    expect(r8.findings.filter((f) => f.severity === 'high')).toHaveLength(0)
    expect(
      r8.suppressed.some((s) => s.verdict === 'suppress-healthy-sitemap-only'),
    ).toBe(true)

    expect(() => rejectedPartialLocaleRemoval()).toThrow(/atomic/)
  })
})
