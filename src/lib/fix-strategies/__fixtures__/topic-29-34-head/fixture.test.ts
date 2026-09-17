import { describe, expect, it } from 'vitest'
import {
  inspectDocumentHead,
  isValidBcp47,
} from '@/lib/fix-strategies/shared'
import { FIX_STRATEGY_PRODUCT_DECISIONS as PD } from '@/lib/fix-strategies/product-decisions'
import { detectTagsOutsideHead } from '@/lib/fix-strategies/topic-29'
import {
  detectTitleMissingOrMalformed,
  rejectedGenerateTitleText,
} from '@/lib/fix-strategies/topic-30'
import {
  detectMetaDescriptionIssues,
  rejectedGenerateDescriptionText,
  rejectedOgFirstWinsForHtmlDescription,
} from '@/lib/fix-strategies/topic-31'
import {
  detectDuplicateTitlesDescriptions,
  rejectedGenerateDistinctTitles,
} from '@/lib/fix-strategies/topic-33'
import {
  detectLangDeclaration,
  suppressArticleMissingInLanguage,
  rejectedDefaultLangEn,
} from '@/lib/fix-strategies/topic-34'

const ORIGIN = 'https://example.com'

function page(opts: {
  head?: string
  body?: string
  lang?: string | null
  langEmpty?: boolean
}): string {
  const langAttr =
    opts.langEmpty === true
      ? ' lang=""'
      : opts.lang != null
        ? ` lang="${opts.lang}"`
        : ''
  return `<!doctype html><html${langAttr}><head>${opts.head ?? ''}</head><body>${opts.body ?? '<h1>Hello</h1><p>content</p>'}</body></html>`
}

describe('ONE head inspection — parser view, not source position', () => {
  it('moves post-div metadata into body casualties', () => {
    const html = page({
      head: `<title>T</title><div id="x"></div><link rel="canonical" href="${ORIGIN}/"><meta name="robots" content="noindex">`,
    })
    const insp = inspectDocumentHead(html, `${ORIGIN}/`)
    expect(insp.prematureClose.detected).toBe(true)
    expect(insp.prematureClose.offender?.tagName).toBe('div')
    expect(insp.prematureClose.casualties.map((c) => c.kind).sort()).toEqual([
      'canonical',
      'robots-meta',
    ])
    expect(insp.titlesInHead).toHaveLength(1)
    expect(insp.parsed.metaByName('robots')).toBeNull()
  })
})

describe('topic 29 — tags outside head', () => {
  it('classifies the dossier fixture set', () => {
    // 1. div + canonical → critical
    const c1 = detectTagsOutsideHead({
      inspection: inspectDocumentHead(
        page({
          head: `<title>T</title><div></div><link rel="canonical" href="${ORIGIN}/">`,
        }),
        `${ORIGIN}/`,
      ),
    })
    expect(c1.findings[0]?.severity).toBe('critical')
    expect(c1.findings[0]?.verdict).toBe('critical-canonical-casualty')

    // 2. div + robots only → low (R8)
    const c2 = detectTagsOutsideHead({
      inspection: inspectDocumentHead(
        page({
          head: `<title>T</title><div></div><meta name="robots" content="noindex">`,
        }),
      ),
    })
    expect(c2.findings[0]?.severity).toBe('low')
    expect(c2.findings[0]?.verdict).toBe('low-robots-casualty')

    // 3. div + nothing → informational
    const c3 = detectTagsOutsideHead({
      inspection: inspectDocumentHead(
        page({ head: `<title>T</title><div></div>` }),
      ),
    })
    expect(c3.findings[0]?.severity).toBe('informational')

    // 4. conforming head → nothing
    const c4 = detectTagsOutsideHead({
      inspection: inspectDocumentHead(
        page({
          head: `<title>T</title><meta name="description" content="d"><link rel="canonical" href="${ORIGIN}/">`,
        }),
      ),
    })
    expect(c4.findings).toHaveLength(0)

    // 5. script in head (permitted) → nothing
    const c5 = detectTagsOutsideHead({
      inspection: inspectDocumentHead(
        page({
          head: `<title>T</title><script>window.__x=1</script><meta name="description" content="d">`,
        }),
      ),
    })
    expect(c5.findings).toHaveLength(0)

    // 6. post-hydration → suppress
    const c6 = detectTagsOutsideHead({
      inspection: inspectDocumentHead(page({ head: `<title>T</title>` })),
      postHydrationOnly: true,
    })
    expect(
      c6.suppressed.some((s) => s.verdict === 'suppress-post-hydration'),
    ).toBe(true)
  })
})

describe('topic 30 — title missing or malformed', () => {
  it('classifies the dossier fixture set — no length threshold', () => {
    const run = (head: string, extra?: { robots?: string; noindex?: boolean }) => {
      const body = extra?.noindex
        ? `<meta name="robots" content="noindex"><h1>H</h1>`
        : `<h1>Primary Heading</h1><p>x</p>`
      // put robots in head when noindex for indexable check via body parse
      const h = extra?.noindex
        ? `${head}<meta name="robots" content="noindex">`
        : head
      const html = page({ head: h, body })
      const inspection = inspectDocumentHead(html, `${ORIGIN}/p`)
      return detectTitleMissingOrMalformed({
        page: {
          inspection,
          status200: true,
          body: html,
          headers: new Headers(),
        },
      })
    }

    // 1. no title → human-review scaffold
    expect(run('').findings[0]?.verdict).toBe('human-review-missing')
    expect(run('').findings[0]?.proposedFromHeading).toBe('Primary Heading')
    expect(run('').findings[0]?.autoFixable).toBe(false)

    // 2. two identical → auto
    expect(
      run('<title>Same</title><title>Same</title>').findings[0]?.verdict,
    ).toBe('auto-remove-identical-duplicates')
    expect(
      run('<title>Same</title><title>Same</title>').findings[0]?.autoFixable,
    ).toBe(true)

    // 3. two differing → human-review
    expect(
      run('<title>A</title><title>B</title>').findings[0]?.verdict,
    ).toBe('human-review-differing-duplicates')

    // 4. empty → human-review
    expect(run('<title>   </title>').findings[0]?.verdict).toBe(
      'human-review-empty',
    )

    // 5. 200-char title → NOTHING (H9)
    const long = 'A'.repeat(200)
    const r5 = run(`<title>${long}</title>`)
    expect(r5.findings).toHaveLength(0)
    expect(r5.suppressed.some((s) => s.verdict === 'ok')).toBe(true)
    expect(PD.titleDisplayTruncationHintChars).toBeNull()

    // 6. noindex + no title → suppress
    const r6 = detectTitleMissingOrMalformed({
      page: {
        inspection: inspectDocumentHead(
          page({
            head: '<meta name="robots" content="noindex">',
            body: '<h1>X</h1>',
          }),
          `${ORIGIN}/n`,
        ),
        status200: true,
        body: page({
          head: '<meta name="robots" content="noindex">',
          body: '<h1>X</h1>',
        }),
      },
    })
    expect(
      r6.suppressed.some((s) => s.verdict === 'suppress-not-indexable'),
    ).toBe(true)

    // 7. title after div → topic 29
    const r7 = detectTitleMissingOrMalformed({
      page: {
        inspection: inspectDocumentHead(
          page({
            head: `<div></div><title>Late</title>`,
            body: `<h1>H</h1>`,
          }),
          `${ORIGIN}/d`,
        ),
        status200: true,
        body: page({
          head: `<div></div><title>Late</title>`,
          body: `<h1>H</h1>`,
        }),
      },
    })
    expect(r7.findings[0]?.verdict).toBe('route-topic-29')

    expect(() => rejectedGenerateTitleText()).toThrow(/REJECTED/)
  })
})

describe('topic 31 — meta description', () => {
  it('classifies the dossier fixture set — missing is informational; no OG first-wins', () => {
    const run = (head: string) => {
      const html = page({
        head: `<title>T</title>${head}`,
        body: '<h1>H</h1><p>page specific content here</p>',
      })
      return detectMetaDescriptionIssues({
        page: {
          inspection: inspectDocumentHead(html, `${ORIGIN}/p`),
          status200: true,
          body: html,
        },
      })
    }

    // 1. missing → informational
    expect(run('').informational[0]?.verdict).toBe('informational-missing')
    expect(run('').findings).toHaveLength(0)

    // 2. two identical → auto
    expect(
      run(
        '<meta name="description" content="Same"><meta name="description" content="Same">',
      ).findings[0]?.verdict,
    ).toBe('auto-remove-identical-duplicates')

    // 3. two differing → human-review (NOT first-wins)
    const diff = run(
      '<meta name="description" content="A"><meta name="description" content="B">',
    )
    expect(diff.findings[0]?.verdict).toBe('human-review-differing-duplicates')
    expect(diff.findings[0]?.usesOgFirstWins).toBe(false)
    expect(diff.findings[0]?.autoFixable).toBe(false)

    // 4. Description vs description (case) → duplicate
    expect(
      run(
        '<meta name="Description" content="X"><meta name="description" content="X">',
      ).findings[0]?.verdict,
    ).toBe('auto-remove-identical-duplicates')

    // 5. empty → auto-remove
    expect(
      run('<meta name="description" content="">').findings[0]?.verdict,
    ).toBe('auto-remove-empty')

    // 6. programmatic page-specific → nothing
    expect(
      run(
        '<meta name="description" content="Buy widgets in Manchester — delivery tomorrow">',
      ).findings,
    ).toHaveLength(0)

    // 7. 600-char → NOTHING (H15)
    const long = 'D'.repeat(600)
    expect(run(`<meta name="description" content="${long}">`).findings).toHaveLength(
      0,
    )
    expect(PD.descriptionDisplayTruncationHintChars).toBeNull()

    expect(() => rejectedGenerateDescriptionText()).toThrow(/REJECTED/)
    expect(() => rejectedOgFirstWinsForHtmlDescription()).toThrow(/REJECTED/)
  })
})

describe('topic 33 — duplicate titles/descriptions across URLs', () => {
  it('classifies the dossier fixture set — exclusion first', () => {
    const mk = (
      url: string,
      title: string,
      opts?: {
        desc?: string
        indexable?: boolean
        canonical?: string
        paginated?: boolean
        declarationSite?: string
      },
    ) => {
      const head = `<title>${title}</title>${
        opts?.desc
          ? `<meta name="description" content="${opts.desc}">`
          : ''
      }${
        opts?.canonical
          ? `<link rel="canonical" href="${opts.canonical}">`
          : `<link rel="canonical" href="${url}">`
      }`
      const html = page({ head, body: '<h1>H</h1>' })
      return {
        url,
        inspection: inspectDocumentHead(html, url),
        indexable: opts?.indexable !== false,
        canonicalTarget: opts?.canonical ?? url,
        paginated: opts?.paginated,
        declarationSite: opts?.declarationSite ?? null,
      }
    }

    // 1. two distinct pages identical titles → finding
    const r1 = detectDuplicateTitlesDescriptions({
      pages: [
        mk(`${ORIGIN}/a`, 'Shared Title'),
        mk(`${ORIGIN}/b`, 'Shared Title'),
      ],
    })
    expect(
      r1.findings.some((f) => f.verdict === 'report-duplicate-titles'),
    ).toBe(true)
    expect(r1.findings[0]?.rankingPenaltyClaimed).toBe(false)

    // 2. /page and /page/ → route topic 8
    const r2 = detectDuplicateTitlesDescriptions({
      pages: [
        mk(`${ORIGIN}/page`, 'Dup'),
        mk(`${ORIGIN}/page/`, 'Dup'),
      ],
    })
    expect(
      r2.routed.some((x) => x.verdict === 'route-topic-8-12-url-variants'),
    ).toBe(true)
    expect(r2.findings).toHaveLength(0)

    // 3. canonicalise to one another → canonical block
    const r3 = detectDuplicateTitlesDescriptions({
      pages: [
        mk(`${ORIGIN}/x`, 'Canon', { canonical: `${ORIGIN}/y` }),
        mk(`${ORIGIN}/y`, 'Canon', { canonical: `${ORIGIN}/y` }),
      ],
    })
    expect(
      r3.routed.some((x) => x.verdict === 'route-topic-13-18-canonical-group'),
    ).toBe(true)

    // 4. paginated → suppress
    const r4 = detectDuplicateTitlesDescriptions({
      pages: [
        mk(`${ORIGIN}/blog?page=1`, 'Blog', { paginated: true }),
        mk(`${ORIGIN}/blog?page=2`, 'Blog', { paginated: true }),
      ],
    })
    // query variants may route to 8-12 first — either suppress-paginated or route
    expect(
      r4.suppressed.some((s) => s.verdict === 'suppress-paginated') ||
        r4.routed.length > 0,
    ).toBe(true)

    // 5. twenty pages one layout → ONE finding naming layout
    const twenty = Array.from({ length: 20 }, (_, i) =>
      mk(`${ORIGIN}/p/${i}`, 'Layout Title', {
        declarationSite: 'app/layout.tsx',
      }),
    )
    const r5 = detectDuplicateTitlesDescriptions({ pages: twenty })
    expect(r5.findings).toHaveLength(1)
    expect(r5.findings[0]?.declarationSite).toBe('app/layout.tsx')
    expect(r5.findings[0]?.detail).toMatch(/app\/layout\.tsx/)

    // 6. brand suffix difference → not identical
    const r6 = detectDuplicateTitlesDescriptions({
      pages: [
        mk(`${ORIGIN}/a`, 'Guide | Acme'),
        mk(`${ORIGIN}/b`, 'Pricing | Acme'),
      ],
    })
    expect(r6.findings).toHaveLength(0)

    // 7. noindex sharing title → excluded from grouping
    const r7 = detectDuplicateTitlesDescriptions({
      pages: [
        mk(`${ORIGIN}/a`, 'Shared'),
        mk(`${ORIGIN}/hidden`, 'Shared', { indexable: false }),
      ],
    })
    expect(r7.findings).toHaveLength(0)

    expect(() => rejectedGenerateDistinctTitles()).toThrow(/REJECTED/)
  })
})

describe('topic 34 — lang declaration', () => {
  it('classifies the dossier fixture set — BCP 47 grammar, never default en', () => {
    expect(isValidBcp47('')).toBe(true)
    expect(isValidBcp47('en-GB')).toBe(true)
    expect(isValidBcp47('zh-Hant')).toBe(true)
    expect(isValidBcp47('pt-BR')).toBe(true)
    expect(isValidBcp47('english')).toBe(false)

    // 1. no lang → human-review (no auth)
    const r1 = detectLangDeclaration({
      inspection: inspectDocumentHead(page({ head: '<title>T</title>' })),
    })
    expect(r1.findings[0]?.verdict).toBe('human-review-missing-lang')
    expect(r1.findings[0]?.searchClaim).toBe(false)
    expect(r1.findings[0]?.proposedLang).toBeNull()

    // 2. en-GB → ok
    const r2 = detectLangDeclaration({
      inspection: inspectDocumentHead(
        page({ head: '<title>T</title>', lang: 'en-GB' }),
      ),
    })
    expect(r2.findings).toHaveLength(0)

    // 3. english → high invalid
    const r3 = detectLangDeclaration({
      inspection: inspectDocumentHead(
        page({ head: '<title>T</title>', lang: 'english' }),
      ),
    })
    expect(r3.findings[0]?.verdict).toBe('high-invalid-bcp47')
    expect(r3.findings[0]?.severity).toBe('high')

    // 4. lang="" → valid suppress
    const r4 = detectLangDeclaration({
      inspection: inspectDocumentHead(
        page({ head: '<title>T</title>', langEmpty: true }),
      ),
    })
    expect(
      r4.suppressed.some((s) => s.verdict === 'suppress-empty-lang-valid'),
    ).toBe(true)

    // 5. lang=en inLanguage=fr → low disagree
    const r5 = detectLangDeclaration({
      inspection: inspectDocumentHead(
        page({
          lang: 'en',
          head: `<title>T</title><script type="application/ld+json">{"@type":"WebPage","inLanguage":"fr"}</script>`,
        }),
      ),
    })
    expect(r5.findings[0]?.verdict).toBe('low-lang-inlanguage-disagree')
    expect(r5.findings[0]?.severity).toBe('low')

    // 6. Book no inLanguage → high
    const r6 = detectLangDeclaration({
      inspection: inspectDocumentHead(
        page({
          lang: 'en',
          head: `<title>T</title><script type="application/ld+json">{"@type":"Book","name":"X"}</script>`,
        }),
      ),
    })
    expect(r6.findings.some((f) => f.verdict === 'high-book-missing-inlanguage')).toBe(
      true,
    )

    // 7. Article no inLanguage → nothing (L9)
    const r7 = detectLangDeclaration({
      inspection: inspectDocumentHead(
        page({
          lang: 'en',
          head: `<title>T</title><script type="application/ld+json">{"@type":"Article","headline":"X"}</script>`,
        }),
      ),
    })
    expect(r7.findings.filter((f) => f.verdict.includes('inlanguage'))).toHaveLength(
      0,
    )
    expect(suppressArticleMissingInLanguage().verdict).toBe(
      'suppress-article-no-inlanguage',
    )

    // 8. nested blockquote lang → ok (document lang present)
    const r8 = detectLangDeclaration({
      inspection: inspectDocumentHead(
        page({
          lang: 'en',
          head: '<title>T</title>',
          body: '<blockquote lang="fr">bonjour</blockquote>',
        }),
      ),
    })
    expect(r8.findings).toHaveLength(0)

    // 9. route locale + no lang → auto-fix
    const r9 = detectLangDeclaration({
      inspection: inspectDocumentHead(page({ head: '<title>T</title>' })),
      authoritativeLocale: 'fr-CA',
    })
    expect(r9.findings[0]?.verdict).toBe('auto-set-lang-from-locale')
    expect(r9.findings[0]?.autoFixable).toBe(true)
    expect(r9.findings[0]?.proposedLang).toBe('fr-CA')

    expect(() => rejectedDefaultLangEn()).toThrow(/REJECTED/)
  })
})

describe('product decisions — no Google length thresholds', () => {
  it('leaves truncation hints unset and unattributed', () => {
    expect(PD.titleDisplayTruncationHintChars).toBeNull()
    expect(PD.descriptionDisplayTruncationHintChars).toBeNull()
  })
})
