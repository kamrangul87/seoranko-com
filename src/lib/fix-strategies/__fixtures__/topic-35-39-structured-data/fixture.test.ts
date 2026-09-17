import { describe, expect, it } from 'vitest'
import {
  extractStructuredData,
  ARTICLE_IMAGE_MIN_PIXELS,
  lookupRequirement,
  lookupDeprecation,
  classifyTypeName,
} from '@/lib/fix-strategies/shared'
import {
  detectRequiredPropertiesAbsent,
  cleanAuthorName,
  splitMergedAuthors,
} from '@/lib/fix-strategies/topic-35'
import {
  detectSchemaUrlsDontResolve,
  rejectedRemoveRequiredUrl,
  rejectedRaiseOnAtId,
} from '@/lib/fix-strategies/topic-36'
import {
  detectInvalidOrMismatchedType,
  rejectedInferEntityKindFromName,
  rejectedGuessJsonLdRepair,
  repairTrailingCommas,
} from '@/lib/fix-strategies/topic-37'
import {
  detectDeprecatedTypes,
  rejectedAutoRemoveDeprecated,
} from '@/lib/fix-strategies/topic-39'
import { robotsInspectionFromBody } from '@/lib/fix-strategies/shared/sitemap-inspect'

const ORIGIN = 'https://example.com'

function page(jsonLd: string | string[], body = '<h1>Page</h1><p>Visible.</p>'): string {
  const scripts = (Array.isArray(jsonLd) ? jsonLd : [jsonLd])
    .map(
      (j) =>
        `<script type="application/ld+json">${j}</script>`,
    )
    .join('')
  return `<!doctype html><html><head><title>T</title>${scripts}</head><body>${body}</body></html>`
}

describe('ONE structured-data extraction', () => {
  it('extracts JSON-LD and records parse failures separately', () => {
    const html = page([
      '{"@context":"https://schema.org","@type":"Article","headline":"H"}',
      '{broken',
    ])
    const ex = extractStructuredData(html, ORIGIN)
    expect(ex.nodes.some((n) => n.types.includes('Article'))).toBe(true)
    expect(ex.parseFailures.length).toBeGreaterThanOrEqual(1)
    // Same extraction feeds all four topics
    detectRequiredPropertiesAbsent({ html, pageUrl: ORIGIN, extraction: ex })
    detectSchemaUrlsDontResolve({ html, pageUrl: ORIGIN, extraction: ex })
    detectInvalidOrMismatchedType({ html, pageUrl: ORIGIN, extraction: ex })
    detectDeprecatedTypes({ html, pageUrl: ORIGIN, extraction: ex })
  })

  it('requirement and deprecation tables require verifiedOn', () => {
    expect(lookupRequirement('Article')?.verifiedOn).toBeTruthy()
    expect(lookupRequirement('Article')?.required).toEqual([])
    expect(lookupRequirement('UnknownTypeX')).toBeNull()
    expect(lookupDeprecation('FAQPage')?.verifiedOn).toBeTruthy()
    expect(lookupDeprecation('HowTo')?.withdrawn).toMatch(/2023/)
    expect(ARTICLE_IMAGE_MIN_PIXELS).toBe(50_000)
  })
})

describe('topic 35 — required properties absent', () => {
  it('classifies the dossier fixture set', () => {
    // 1. BreadcrumbList missing required itemListElement → finding
    const r1 = detectRequiredPropertiesAbsent({
      html: page(
        '{"@context":"https://schema.org","@type":"BreadcrumbList"}',
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r1.findings.some((f) => f.verdict === 'finding-required-absent'),
    ).toBe(true)
    expect(
      r1.findings.find((f) => f.verdict === 'finding-required-absent')?.property,
    ).toBe('itemListElement')

    // 2. Article with no image → NOTHING (recommended only)
    const r2 = detectRequiredPropertiesAbsent({
      html: page(
        '{"@context":"https://schema.org","@type":"Article","headline":"H"}',
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r2.findings.some((f) => f.verdict === 'finding-required-absent'),
    ).toBe(false)
    expect(
      r2.suppressed.some((s) => s.verdict === 'suppress-article-recommended-only'),
    ).toBe(true)

    // 3. author.name cleanup → auto
    const r3 = detectRequiredPropertiesAbsent({
      html: page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          author: {
            '@type': 'Person',
            name: 'posted by Dr Jane Doe, Editor',
          },
        }),
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r3.findings.some((f) => f.verdict === 'auto-fix-author-name-cleanup'),
    ).toBe(true)
    const cleaned = cleanAuthorName('posted by Dr Jane Doe, Editor')
    expect(cleaned.name).toBe('Jane Doe')
    expect(cleaned.jobTitle).toBe('Editor')
    expect(cleaned.honorificPrefix).toBe('Dr')

    // 4. merged authors → auto split
    const r4 = detectRequiredPropertiesAbsent({
      html: page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          author: { '@type': 'Person', name: 'Jane Doe and John Smith' },
        }),
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r4.findings.some((f) => f.verdict === 'auto-fix-split-merged-authors'),
    ).toBe(true)
    expect(splitMergedAuthors('Jane Doe and John Smith')).toEqual([
      'Jane Doe',
      'John Smith',
    ])

    // 5. type absent from table → nothing
    const r5 = detectRequiredPropertiesAbsent({
      html: page(
        '{"@context":"https://schema.org","@type":"WidgetFactory"}',
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r5.suppressed.some((s) => s.verdict === 'suppress-unknown-type'),
    ).toBe(true)
    expect(r5.findings.filter((f) => f.verdict === 'finding-required-absent')).toHaveLength(
      0,
    )

    // 6. required absent but in repo → scaffold auto
    const r6 = detectRequiredPropertiesAbsent({
      html: page(
        '{"@context":"https://schema.org","@type":"BreadcrumbList"}',
      ),
      pageUrl: ORIGIN,
      repoPropertyValues: {
        itemListElement: '[{"@type":"ListItem","position":1,"name":"Home"}]',
      },
    })
    expect(
      r6.findings.some((f) => f.verdict === 'auto-fix-scaffold-from-repo'),
    ).toBe(true)

    // 7. valid markup / no rich result — not a finding (D3)
    // Covered by Article with all recommended still not guaranteeing rich result —
    // we simply don't raise a "no rich result" verdict.
    expect(ARTICLE_IMAGE_MIN_PIXELS).toBe(50_000)
  })
})

describe('topic 36 — schema URLs', () => {
  it('classifies the dossier fixture set — never raise on @id', () => {
    const articleWithImage = (img: string) =>
      page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'H',
          image: img,
          '@id': `${ORIGIN}/#article`,
        }),
      )

    // 1. image 404 on Article (recommended) → moderate / auto-remove recommended
    const r1 = detectSchemaUrlsDontResolve({
      html: articleWithImage(`${ORIGIN}/missing.jpg`),
      pageUrl: ORIGIN,
      probes: {
        [`${ORIGIN}/missing.jpg`]: {
          url: `${ORIGIN}/missing.jpg`,
          status: 404,
          confirmed: true,
        },
      },
    })
    expect(
      r1.findings.some((f) => f.verdict === 'auto-remove-dead-recommended'),
    ).toBe(true)
    expect(
      r1.findings.find((f) => f.verdict === 'auto-remove-dead-recommended')
        ?.severity,
    ).toBe('moderate')
    expect(r1.suppressed.some((s) => s.verdict === 'suppress-at-id-identifier')).toBe(
      true,
    )

    // 2. relative image → auto-absolutize
    const r2 = detectSchemaUrlsDontResolve({
      html: articleWithImage('/img/hero.jpg'),
      pageUrl: ORIGIN,
    })
    expect(
      r2.findings.some((f) => f.verdict === 'auto-absolutize-relative'),
    ).toBe(true)

    // 3. single-hop redirect → auto-repoint
    const r3 = detectSchemaUrlsDontResolve({
      html: articleWithImage(`${ORIGIN}/old.jpg`),
      pageUrl: ORIGIN,
      probes: {
        [`${ORIGIN}/old.jpg`]: {
          url: `${ORIGIN}/old.jpg`,
          status: 200,
          redirectHops: 1,
          finalUrl: `${ORIGIN}/new.jpg`,
        },
      },
    })
    expect(r3.findings.some((f) => f.verdict === 'auto-repoint-redirect')).toBe(
      true,
    )

    // 4. live external author.url → nothing
    const r4 = detectSchemaUrlsDontResolve({
      html: page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          author: {
            '@type': 'Person',
            name: 'Jane',
            url: 'https://orcid.org/0000-0001',
          },
        }),
      ),
      pageUrl: ORIGIN,
      probes: {
        'https://orcid.org/0000-0001': {
          url: 'https://orcid.org/0000-0001',
          status: 200,
        },
      },
    })
    expect(
      r4.suppressed.some((s) => s.verdict === 'suppress-live-external-profile'),
    ).toBe(true)

    // 5. @id that does not resolve → suppress (never raise)
    expect(() => rejectedRaiseOnAtId()).toThrow(/REJECTED/)

    // 6. unsupported image format
    const r6 = detectSchemaUrlsDontResolve({
      html: articleWithImage(`${ORIGIN}/x.tiff`),
      pageUrl: ORIGIN,
      probes: {
        [`${ORIGIN}/x.tiff`]: {
          url: `${ORIGIN}/x.tiff`,
          status: 200,
          contentType: 'image/tiff',
        },
      },
    })
    expect(r6.findings.some((f) => f.verdict === 'format-unsupported')).toBe(
      true,
    )

    // 7. robots-disallowed image → human-review
    const robots = robotsInspectionFromBody(
      'User-agent: *\nDisallow: /private/\n',
    )
    const r7 = detectSchemaUrlsDontResolve({
      html: articleWithImage(`${ORIGIN}/private/secret.jpg`),
      pageUrl: ORIGIN,
      robots,
    })
    expect(
      r7.findings.some((f) => f.verdict === 'human-review-robots-disallow'),
    ).toBe(true)

    expect(() => rejectedRemoveRequiredUrl()).toThrow(/REJECTED/)
  })
})

describe('topic 37 — invalid or mismatched type', () => {
  it('classifies the dossier fixture set', () => {
    // 1. Artical → auto spelling
    const r1 = detectInvalidOrMismatchedType({
      html: page(
        '{"@context":"https://schema.org","@type":"Artical","headline":"H"}',
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r1.findings.some((f) => f.verdict === 'auto-fix-type-spelling'),
    ).toBe(true)
    expect(
      r1.findings.find((f) => f.verdict === 'auto-fix-type-spelling')
        ?.suggestion,
    ).toBe('Article')

    // 2. Course — valid, never raise
    expect(classifyTypeName('Course').kind).toBe('valid')
    const r2 = detectInvalidOrMismatchedType({
      html: page(
        '{"@context":"https://schema.org","@type":"Course","name":"C"}',
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r2.findings.some((f) => f.verdict === 'auto-fix-type-spelling'),
    ).toBe(false)

    // 3. author Thing + repo Person → auto
    const r3 = detectInvalidOrMismatchedType({
      html: page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          author: { '@type': 'Thing', name: 'Jane' },
        }),
      ),
      pageUrl: ORIGIN,
      authorEntityKind: 'Person',
    })
    expect(
      r3.findings.some((f) => f.verdict === 'auto-fix-thing-to-person-or-org'),
    ).toBe(true)
    expect(
      r3.findings.find((f) => f.verdict === 'auto-fix-thing-to-person-or-org')
        ?.suggestion,
    ).toBe('Person')

    // 4. invalid property → human-review
    const r4 = detectInvalidOrMismatchedType({
      html: page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Person',
          notARealPropertyXYZ: true,
          name: 'Jane',
        }),
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r4.findings.some((f) => f.verdict === 'human-review-invalid-property'),
    ).toBe(true)

    // 5. @context absent → auto
    const r5 = detectInvalidOrMismatchedType({
      html: page('{"@type":"Article","headline":"H"}'),
      pageUrl: ORIGIN,
    })
    expect(r5.findings.some((f) => f.verdict === 'auto-fix-context')).toBe(
      true,
    )

    // 6. trailing comma → auto
    const r6 = detectInvalidOrMismatchedType({
      html: page(
        '{"@context":"https://schema.org","@type":"Article","headline":"H",}',
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r6.findings.some((f) => f.verdict === 'auto-fix-trailing-comma'),
    ).toBe(true)
    expect(
      repairTrailingCommas(
        '{"@context":"https://schema.org","@type":"Article","headline":"H",}',
      ),
    ).not.toMatch(/,}/)

    // 7. ambiguous damage → human-review
    const r7 = detectInvalidOrMismatchedType({
      html: page('{"@type":"Article","headline":'),
      pageUrl: ORIGIN,
    })
    expect(
      r7.findings.some((f) => f.verdict === 'human-review-ambiguous-parse'),
    ).toBe(true)

    // 8. @type array → ok
    const r8 = detectInvalidOrMismatchedType({
      html: page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': ['Article', 'BlogPosting'],
          headline: 'H',
        }),
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r8.suppressed.some((s) => s.verdict === 'suppress-type-array-ok'),
    ).toBe(true)

    expect(() => rejectedInferEntityKindFromName()).toThrow(/REJECTED/)
    expect(() => rejectedGuessJsonLdRepair()).toThrow(/REJECTED/)
  })
})

describe('topic 39 — deprecated types', () => {
  it('classifies the dossier fixture set — informational, never auto-remove', () => {
    // 1. FAQPage → informational
    const r1 = detectDeprecatedTypes({
      html: page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [],
        }),
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r1.informational.some((f) => f.verdict === 'informational-deprecated-type'),
    ).toBe(true)
    expect(r1.informational[0]?.proposeRemovalUnprompted).toBe(false)
    expect(r1.informational[0]?.penaltyClaimed).toBe(false)
    expect(r1.informational[0]?.verifiedOn).toBeTruthy()

    // 2. HowTo → informational
    const r2 = detectDeprecatedTypes({
      html: page(
        '{"@context":"https://schema.org","@type":"HowTo","name":"X","step":[]}',
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r2.informational.some((f) => f.typeName === 'HowTo'),
    ).toBe(true)

    // 3. Course → nothing (supported / not deprecated)
    const r3 = detectDeprecatedTypes({
      html: page(
        '{"@context":"https://schema.org","@type":"Course","name":"C"}',
      ),
      pageUrl: ORIGIN,
    })
    expect(r3.informational).toHaveLength(0)
    expect(
      r3.suppressed.some((s) => s.verdict === 'suppress-supported-type'),
    ).toBe(true)

    // 4. FAQPage without visible Q&A → D17 finding
    const r4 = detectDeprecatedTypes({
      html: page(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'Hidden?',
              acceptedAnswer: { '@type': 'Answer', text: 'Yes' },
            },
          ],
        }),
        '<h1>Page</h1><p>No FAQ UI here.</p>',
      ),
      pageUrl: ORIGIN,
    })
    expect(
      r4.findings.some((f) => f.verdict === 'd17-faq-markup-not-visible'),
    ).toBe(true)

    // 5. undated table entry → no finding
    const r5 = detectDeprecatedTypes({
      html: page(
        '{"@context":"https://schema.org","@type":"Article","headline":"H"}',
      ),
      pageUrl: ORIGIN,
      undatedTestEntry: {
        type: 'SpecialAnnouncement',
        withdrawn: 'sometime',
        sourceUrl: 'https://example.com',
      },
    })
    expect(
      r5.suppressed.some((s) => s.verdict === 'suppress-undated-table-entry'),
    ).toBe(true)

    expect(() => rejectedAutoRemoveDeprecated()).toThrow(/REJECTED/)
  })
})
