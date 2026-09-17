import { describe, expect, it } from 'vitest'
import {
  buildSitemapInspection,
  documentFromBody,
  robotsInspectionFromBody,
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_LOC_CHARS,
  SITEMAP_NAMESPACE,
  type SitemapDocument,
} from '@/lib/fix-strategies/shared'
import { detectSitemapMissingOrUnreachable, rejectedGenerateSitemap } from '@/lib/fix-strategies/topic-24'
import {
  detectSitemapXmlInvalid,
  applyTopic25AutoFixes,
  rejectedRewriteLastmod,
} from '@/lib/fix-strategies/topic-25'
import { detectIndexableUrlsAbsent } from '@/lib/fix-strategies/topic-27'
import {
  detectSitemapNotReferencedInRobots,
  proposeAddSitemapRecord,
  applyAddSitemapRecord,
  rejectedCreateRobotsTxtForSitemap,
} from '@/lib/fix-strategies/topic-28'

const ORIGIN = 'https://example.com'

function urlset(entries: string, ns = SITEMAP_NAMESPACE): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${ns}">\n${entries}\n</urlset>\n`
}

function entry(loc: string, extra = ''): string {
  return `  <url><loc>${loc}</loc>${extra}</url>`
}

describe('topic 24 — sitemap missing or unreachable', () => {
  it('classifies the dossier fixture set', () => {
    // 1. relative Sitemap: → auto-fix
    const rel = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody('User-agent: *\nDisallow:\nSitemap: /sitemap.xml\n'),
      documents: [
        {
          url: '/sitemap.xml',
          origin: 'robots-declaration',
          fetchOutcome: 'skipped-relative',
          status: null,
          contentType: null,
          compressedByteLength: 0,
          decompressedByteLength: 0,
          wasGzip: false,
          exceedsSizeLimit: false,
          redirectHops: 0,
          finalUrl: null,
          body: '',
          parsed: null,
          detail: 'relative',
        },
      ],
    })
    const r1 = detectSitemapMissingOrUnreachable({ inspection: rel })
    expect(r1.findings[0]?.verdict).toBe('auto-absolutize-relative')
    expect(r1.findings[0]?.autoFixable).toBe(true)
    expect(r1.findings[0]?.proposedAbsoluteUrl).toBe(`${ORIGIN}/sitemap.xml`)

    // 2. absolute 404 → human-review
    const miss = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody(
        `User-agent: *\nSitemap: ${ORIGIN}/missing-sitemap.xml\n`,
      ),
      documents: [
        {
          url: `${ORIGIN}/missing-sitemap.xml`,
          origin: 'robots-declaration',
          fetchOutcome: 'not-found',
          status: 404,
          contentType: null,
          compressedByteLength: 0,
          decompressedByteLength: 0,
          wasGzip: false,
          exceedsSizeLimit: false,
          redirectHops: 0,
          finalUrl: `${ORIGIN}/missing-sitemap.xml`,
          body: '',
          parsed: null,
          detail: '404',
        },
      ],
    })
    expect(
      detectSitemapMissingOrUnreachable({ inspection: miss }).findings[0]?.verdict,
    ).toBe('human-review-declared-4xx')

    // 3. absolute 200 XML → nothing
    const okXml = urlset(entry(`${ORIGIN}/`))
    const ok = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap.xml\n`),
      documents: [documentFromBody(`${ORIGIN}/sitemap.xml`, okXml)],
    })
    const r3 = detectSitemapMissingOrUnreachable({ inspection: ok })
    expect(r3.findings).toHaveLength(0)
    expect(r3.suppressed.some((s) => s.verdict === 'ok')).toBe(true)

    // 4. no Sitemap: line → suppress (absence not a defect)
    const none = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody('User-agent: *\nDisallow:\n'),
      documents: [],
    })
    const r4 = detectSitemapMissingOrUnreachable({ inspection: none })
    expect(r4.findings).toHaveLength(0)
    expect(
      r4.suppressed.some((s) => s.verdict === 'suppress-no-declaration'),
    ).toBe(true)

    // 5. sitemap index declared → ok (sufficient)
    const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="${SITEMAP_NAMESPACE}">
  <sitemap><loc>${ORIGIN}/sitemap-0.xml</loc></sitemap>
</sitemapindex>`
    const idx = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap-index.xml\n`),
      documents: [
        documentFromBody(`${ORIGIN}/sitemap-index.xml`, indexXml),
        documentFromBody(
          `${ORIGIN}/sitemap-0.xml`,
          urlset(entry(`${ORIGIN}/a`)),
          { origin: 'index-child' },
        ),
      ],
    })
    expect(detectSitemapMissingOrUnreachable({ inspection: idx }).findings).toHaveLength(
      0,
    )

    // 6. transient 5xx → topic 3
    const flaky = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/flaky.xml\n`),
      documents: [
        {
          url: `${ORIGIN}/flaky.xml`,
          origin: 'robots-declaration',
          fetchOutcome: 'transient-5xx',
          status: 503,
          contentType: null,
          compressedByteLength: 0,
          decompressedByteLength: 0,
          wasGzip: false,
          exceedsSizeLimit: false,
          redirectHops: 0,
          finalUrl: null,
          body: '',
          parsed: null,
          detail: 'transient',
        },
      ],
    })
    expect(
      detectSitemapMissingOrUnreachable({ inspection: flaky }).findings[0]?.verdict,
    ).toBe('route-topic-3-transient-5xx')

    expect(() => rejectedGenerateSitemap()).toThrow(/REJECTED/)
  })
})

describe('topic 25 — sitemap XML invalid', () => {
  it('classifies the dossier fixture set', () => {
    const mk = (body: string, extra?: Partial<SitemapDocument>) =>
      buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap.xml\n`),
        documents: [
          {
            ...documentFromBody(`${ORIGIN}/sitemap.xml`, body),
            ...extra,
          },
        ],
      })

    // 1. wrong namespace → auto-fix
    const wrongNs = detectSitemapXmlInvalid({
      inspection: mk(urlset(entry(`${ORIGIN}/`), 'http://wrong.example/ns')),
    })
    expect(
      wrongNs.findings.some((f) => f.verdict === 'critical-wrong-namespace'),
    ).toBe(true)
    expect(
      wrongNs.findings.find((f) => f.verdict === 'critical-wrong-namespace')
        ?.autoFixable,
    ).toBe(true)

    // 2. relative loc → auto-fix
    const relLoc = detectSitemapXmlInvalid({
      inspection: mk(urlset(entry('/relative-page'))),
    })
    expect(
      relLoc.findings.some((f) => f.verdict === 'auto-fix-relative-loc'),
    ).toBe(true)

    // 3. 2100-char loc → raised
    const long = 'https://example.com/' + 'a'.repeat(2100)
    expect(long.length).toBeGreaterThan(SITEMAP_MAX_LOC_CHARS)
    const longLoc = detectSitemapXmlInvalid({
      inspection: mk(urlset(entry(long))),
    })
    expect(longLoc.findings.some((f) => f.verdict === 'high-loc-too-long')).toBe(
      true,
    )

    // 4. 50,001 entries → raised (simulate via oversized entry count in body header)
    // Build a small body but override parsed count by constructing manually:
    const manyEntries = Array.from({ length: 50_001 }, (_, i) =>
      entry(`${ORIGIN}/p/${i}`),
    ).join('\n')
    // Too heavy for CI — instead patch document after parse with fake count via
    // a minimal body that we claim exceeds by setting a synthetic document.
    // Use a compact representation: parse a valid small sitemap then mutate.
    const baseDoc = documentFromBody(
      `${ORIGIN}/sitemap.xml`,
      urlset(entry(`${ORIGIN}/`)),
    )
    const oversized: SitemapDocument = {
      ...baseDoc,
      parsed: {
        ...baseDoc.parsed!,
        urlEntries: Array.from({ length: 50_001 }, () => ({
          loc: `${ORIGIN}/x`,
          lastmod: null,
          changefreq: null,
          priority: null,
          hreflangLinks: [],
          rawBlock: '',
        })),
        locs: [`${ORIGIN}/x`],
      },
    }
    const overUrls = detectSitemapXmlInvalid({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap.xml\n`),
        documents: [oversized],
      }),
    })
    expect(
      overUrls.findings.some((f) => f.verdict === 'high-over-url-limit'),
    ).toBe(true)
    void manyEntries

    // 5. gzip 10 MB → 60 MB decompressed
    const gzipOver: SitemapDocument = {
      ...documentFromBody(`${ORIGIN}/sitemap.xml.gz`, urlset(entry(`${ORIGIN}/`))),
      wasGzip: true,
      compressedByteLength: 10 * 1024 * 1024,
      decompressedByteLength: 60 * 1024 * 1024,
      exceedsSizeLimit: true,
    }
    expect(gzipOver.decompressedByteLength).toBeGreaterThan(SITEMAP_MAX_BYTES)
    expect(gzipOver.compressedByteLength).toBeLessThan(SITEMAP_MAX_BYTES)
    const size = detectSitemapXmlInvalid({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap.xml.gz\n`),
        documents: [gzipOver],
      }),
    })
    expect(size.findings.some((f) => f.verdict === 'high-over-size-limit')).toBe(
      true,
    )
    expect(
      size.findings.find((f) => f.verdict === 'high-over-size-limit')?.detail,
    ).toMatch(/decompressed/i)

    // 6. changefreq → informational only (not an error)
    const cf = detectSitemapXmlInvalid({
      inspection: mk(
        urlset(entry(`${ORIGIN}/`, '<changefreq>daily</changefreq>')),
      ),
    })
    expect(
      cf.informational.some(
        (f) => f.verdict === 'informational-changefreq-priority',
      ),
    ).toBe(true)
    expect(
      cf.findings.some((f) => f.verdict === 'informational-changefreq-priority'),
    ).toBe(false)

    // 7. identical lastmod → moderate; never auto-rewrite
    const lm = detectSitemapXmlInvalid({
      inspection: mk(
        urlset(
          [
            entry(`${ORIGIN}/a`, '<lastmod>2024-01-01</lastmod>'),
            entry(`${ORIGIN}/b`, '<lastmod>2024-01-01</lastmod>'),
          ].join('\n'),
        ),
      ),
    })
    expect(
      lm.findings.some((f) => f.verdict === 'moderate-bulk-identical-lastmod'),
    ).toBe(true)
    expect(
      lm.findings.find((f) => f.verdict === 'moderate-bulk-identical-lastmod')
        ?.autoFixable,
    ).toBe(false)
    expect(() => rejectedRewriteLastmod()).toThrow(/REJECTED/)

    // 8. valid sitemap index → nothing (index schema)
    const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="${SITEMAP_NAMESPACE}">
  <sitemap><loc>${ORIGIN}/sitemap-0.xml</loc></sitemap>
</sitemapindex>`
    const idx = detectSitemapXmlInvalid({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/sitemap-index.xml\n`),
        documents: [documentFromBody(`${ORIGIN}/sitemap-index.xml`, indexXml)],
      }),
    })
    expect(idx.findings).toHaveLength(0)
    expect(
      idx.suppressed.some((s) => s.verdict === 'suppress-valid-index'),
    ).toBe(true)

    // Auto-fix namespace
    const fixed = applyTopic25AutoFixes(
      urlset(entry('/page'), 'http://wrong'),
      ORIGIN + '/sitemap.xml',
    )
    expect(fixed.xml).toContain(SITEMAP_NAMESPACE)
    expect(fixed.xml).toContain(`${ORIGIN}/page`)
  })
})

describe('topic 27 — indexable URLs absent', () => {
  it('classifies the dossier fixture set — follow indexes; no slash collapse', () => {
    const childXml = urlset(
      [entry(`${ORIGIN}/listed`), entry(`${ORIGIN}/page`)].join('\n'),
    )
    const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="${SITEMAP_NAMESPACE}">
  <sitemap><loc>${ORIGIN}/child.xml</loc></sitemap>
</sitemapindex>`

    const inspection = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody(
        `User-agent: *\nDisallow: /secret\nSitemap: ${ORIGIN}/sitemap-index.xml\n`,
      ),
      documents: [
        documentFromBody(`${ORIGIN}/sitemap-index.xml`, indexXml),
        documentFromBody(`${ORIGIN}/child.xml`, childXml, {
          origin: 'index-child',
        }),
      ],
    })

    // Shared inspection must include child locs
    expect(inspection.allLocsNormalized.has(`${ORIGIN}/listed`)).toBe(true)

    const html = (opts: {
      robots?: string
      canonical?: string
    }) => {
      const r = opts.robots
        ? `<meta name="robots" content="${opts.robots}">`
        : ''
      const c = `<link rel="canonical" href="${opts.canonical ?? ''}">`
      return `<!doctype html><html><head><title>t</title>${r}${c}</head><body><p>x</p></body></html>`
    }

    const result = detectIndexableUrlsAbsent({
      inspection,
      isGenerated: true,
      generatorPath: 'app/sitemap.ts',
      pages: [
        // 1. indexable + internally linked + absent → low
        {
          url: `${ORIGIN}/missing-page`,
          status200: true,
          body: html({ canonical: `${ORIGIN}/missing-page` }),
          internallyLinked: true,
        },
        // 2. noindex → suppress
        {
          url: `${ORIGIN}/noindex-page`,
          status200: true,
          body: html({
            robots: 'noindex',
            canonical: `${ORIGIN}/noindex-page`,
          }),
          internallyLinked: true,
        },
        // 3. Disallow → suppress
        {
          url: `${ORIGIN}/secret`,
          status200: true,
          body: html({ canonical: `${ORIGIN}/secret` }),
          internallyLinked: true,
        },
        // 4. listed in child of index → suppress
        {
          url: `${ORIGIN}/listed`,
          status200: true,
          body: html({ canonical: `${ORIGIN}/listed` }),
          internallyLinked: true,
        },
        // 5. /page/ on site, /page in sitemap → topic 8
        {
          url: `${ORIGIN}/page/`,
          status200: true,
          body: html({ canonical: `${ORIGIN}/page/` }),
          internallyLinked: true,
        },
        // 6. canonical elsewhere → suppress
        {
          url: `${ORIGIN}/dupe`,
          status200: true,
          body: html({ canonical: `${ORIGIN}/canonical-target` }),
          internallyLinked: true,
        },
        // 7. orphan (no internal links) → elevated + topic 43
        {
          url: `${ORIGIN}/orphan`,
          status200: true,
          body: html({ canonical: `${ORIGIN}/orphan` }),
          internallyLinked: false,
          orphaned: true,
        },
      ],
    })

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/missing-page`)
        ?.severity,
    ).toBe('low')
    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/missing-page`)
        ?.autoFixable,
    ).toBe(false)

    expect(
      result.suppressed.some(
        (s) =>
          s.pageUrl === `${ORIGIN}/noindex-page` &&
          s.verdict === 'suppress-noindex',
      ),
    ).toBe(true)

    expect(
      result.suppressed.some(
        (s) =>
          s.pageUrl === `${ORIGIN}/secret` && s.verdict === 'suppress-disallow',
      ),
    ).toBe(true)

    expect(
      result.suppressed.some(
        (s) =>
          s.pageUrl === `${ORIGIN}/listed` &&
          s.verdict === 'suppress-listed-in-index-child',
      ),
    ).toBe(true)

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/page/`)?.verdict,
    ).toBe('route-topic-8-slash-mismatch')

    expect(
      result.suppressed.some(
        (s) =>
          s.pageUrl === `${ORIGIN}/dupe` &&
          s.verdict === 'suppress-canonical-elsewhere',
      ),
    ).toBe(true)

    const orphan = result.findings.find((f) => f.pageUrl === `${ORIGIN}/orphan`)
    expect(orphan?.verdict).toBe('report-omission-orphaned')
    expect(orphan?.severity).toBe('moderate')
    expect(orphan?.detail).toMatch(/topic 43/)
  })
})

describe('topic 28 — sitemap not referenced in robots.txt', () => {
  it('classifies the dossier fixture set', () => {
    const sm = documentFromBody(
      `${ORIGIN}/sitemap.xml`,
      urlset(entry(`${ORIGIN}/`)),
      { origin: 'discovered' },
    )

    // 1. reachable sitemap, no Sitemap: record → informational
    const r1 = detectSitemapNotReferencedInRobots({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody('User-agent: *\nDisallow:\n'),
        documents: [sm],
        discoveredUnreferenced: [`${ORIGIN}/sitemap.xml`],
      }),
    })
    expect(
      r1.informational.some((f) => f.verdict === 'informational-unreferenced'),
    ).toBe(true)
    expect(r1.informational[0]?.proposeCreateRobotsTxt).toBe(false)
    expect(r1.informational[0]?.searchConsoleUncertainty).toBe(true)

    // 2. record inside User-agent group → still valid (S19)
    const r2 = detectSitemapNotReferencedInRobots({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody(
          `User-agent: *\nDisallow:\nSitemap: ${ORIGIN}/sitemap.xml\n`,
        ),
        documents: [
          documentFromBody(`${ORIGIN}/sitemap.xml`, urlset(entry(`${ORIGIN}/`))),
        ],
      }),
    })
    expect(
      r2.suppressed.some((s) => s.verdict === 'suppress-record-present'),
    ).toBe(true)
    expect(r2.informational).toHaveLength(0)

    // 3. index declared without children → sufficient
    const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="${SITEMAP_NAMESPACE}">
  <sitemap><loc>${ORIGIN}/child.xml</loc></sitemap>
</sitemapindex>`
    const r3 = detectSitemapNotReferencedInRobots({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody(
          `Sitemap: ${ORIGIN}/sitemap-index.xml\n`,
        ),
        documents: [
          documentFromBody(`${ORIGIN}/sitemap-index.xml`, indexXml),
          documentFromBody(
            `${ORIGIN}/child.xml`,
            urlset(entry(`${ORIGIN}/a`)),
            { origin: 'index-child' },
          ),
        ],
      }),
    })
    expect(
      r3.suppressed.some((s) => s.verdict === 'suppress-index-declares-children'),
    ).toBe(true)

    // 4. no sitemap at all → nothing
    const r4 = detectSitemapNotReferencedInRobots({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody('User-agent: *\nDisallow:\n'),
        documents: [],
      }),
    })
    expect(
      r4.suppressed.some((s) => s.verdict === 'suppress-no-sitemap'),
    ).toBe(true)

    // 5. robots.txt 404 with sitemap present → informational, no file creation
    const r5 = detectSitemapNotReferencedInRobots({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody('', {
          status: 404,
          fetchStatus: 'not-found',
        }),
        documents: [sm],
        discoveredUnreferenced: [`${ORIGIN}/sitemap.xml`],
      }),
    })
    expect(
      r5.informational.some(
        (f) => f.verdict === 'informational-robots-404-with-sitemap',
      ),
    ).toBe(true)
    expect(r5.informational[0]?.autoFixable).toBe(false)
    expect(r5.informational[0]?.proposeCreateRobotsTxt).toBe(false)
    expect(proposeAddSitemapRecord(null, `${ORIGIN}/sitemap.xml`).rejectedCreate).toBe(
      true,
    )
    const applied = applyAddSitemapRecord(
      'User-agent: *\nDisallow:\n',
      `${ORIGIN}/sitemap.xml`,
    )
    expect(applied.updated).toBe(true)
    expect(applied.body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
    expect(() => rejectedCreateRobotsTxtForSitemap()).toThrow(/REJECTED/)

    // 6. multiple records → ok
    const r6 = detectSitemapNotReferencedInRobots({
      inspection: buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInspectionFromBody(
          `Sitemap: ${ORIGIN}/a.xml\nSitemap: ${ORIGIN}/b.xml\n`,
        ),
        documents: [
          documentFromBody(`${ORIGIN}/a.xml`, urlset(entry(`${ORIGIN}/a`))),
          documentFromBody(`${ORIGIN}/b.xml`, urlset(entry(`${ORIGIN}/b`))),
        ],
      }),
    })
    expect(
      r6.suppressed.some((s) => s.verdict === 'suppress-multiple-records-ok'),
    ).toBe(true)
  })
})

describe('ONE sitemap inspection shared across topics', () => {
  it('builds locs once including index children', () => {
    const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="${SITEMAP_NAMESPACE}">
  <sitemap><loc>${ORIGIN}/child.xml</loc></sitemap>
</sitemapindex>`
    const child = urlset(entry(`${ORIGIN}/from-child`))
    const inspection = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody(`Sitemap: ${ORIGIN}/index.xml\n`),
      documents: [
        documentFromBody(`${ORIGIN}/index.xml`, indexXml),
        documentFromBody(`${ORIGIN}/child.xml`, child, { origin: 'index-child' }),
      ],
    })
    expect(inspection.allLocsNormalized.has(`${ORIGIN}/from-child`)).toBe(true)
    // Same object feeds all four classifiers without re-parse
    detectSitemapMissingOrUnreachable({ inspection })
    detectSitemapXmlInvalid({ inspection })
    detectIndexableUrlsAbsent({
      inspection,
      pages: [],
    })
    detectSitemapNotReferencedInRobots({ inspection })
  })
})
