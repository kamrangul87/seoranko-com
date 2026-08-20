/**
 * Phase 11 — schema final-artifact rule regressions.
 *
 * Historical bug: Quality Gate reported Article.image / Organization.logo as
 * missing when the FINAL HTML already contained them (validated an intermediate
 * snapshot, or logo policy diverged across generation / recheck / Fix All).
 *
 * Invariant: ONE final HTML → ONE schema → ONE Quality Gate → ONE score.
 */

import { describe, it, expect } from 'vitest'
import { buildFinalArticleArtifact } from './final-article-artifact'
import {
  collectSchemaQualityIssues,
  runQualityGate,
} from './article-quality-gate'
import { validateSchema } from './schema-validator'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
} from './quality-gate-policy'
import type { ArticleImageSet, GeneratedImage } from './image-generator'

function img(partial: Partial<GeneratedImage> & { id: string; url: string }): GeneratedImage {
  return {
    width: 800,
    height: 533,
    alt: 'alt',
    caption: 'caption',
    placement: 'content',
    prompt: 'prompt',
    ...partial,
  }
}

const HERO = 'https://cdn.example.com/phase11-hero.webp'
const LOGO = 'https://example.com/logo.png'

const prose = `
<h1>Home EV charger installation guide</h1>
<p>By Kamran Gul. Installing a home EV charger starts with confirming your supply capacity and choosing a unit that matches your vehicle's charge rate.</p>
<p>Next, book a qualified installer. After fitting, test the unit and register it with your network operator where required.</p>
<h2>Costs and permits</h2>
<p>Permit rules vary by location. Always check local guidance before work begins.</p>
`

const schemaFields = {
  title: 'Home EV charger installation guide',
  description: 'How to install a home EV charger safely.',
  keyword: 'home EV charger installation',
  authorName: 'Kamran Gul',
  publishDate: '2026-08-18T00:00:00.000Z',
  dateModified: '2026-08-18T00:00:00.000Z',
  articleUrl: 'https://example.com/blog/home-ev-charger-installation',
  organizationName: 'Example Brand',
  organizationUrl: 'https://example.com',
  organizationLogoUrl: LOGO,
  market: 'United Kingdom',
}

function imageSet(): ArticleImageSet {
  return {
    hero: img({ id: 'hero', url: HERO, width: 1200, height: 630, placement: 'Hero' }),
    content: [img({ id: 'c0', url: 'https://cdn.example.com/c1.webp' })],
    niche: 'automotive',
    styleDescriptor: 'editorial',
    imageStats: { requested: 2, generated: 2, failures: [] },
  }
}

describe('Phase 11 — final artifact schema ↔ Quality Gate parity', () => {
  it('when final HTML has Article.image and Organization.logo, QG must not report them missing', async () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: prose,
      imageSet: imageSet(),
      schemaInput: schemaFields,
    })

    expect(artifact.html).toContain(HERO)
    expect(artifact.html).toContain(LOGO)
    expect(artifact.primaryImageUrl).toBe(HERO)
    expect(artifact.schemaResult.imageUrl).toBe(HERO)

    const requireLogo = expectOrganizationLogoFromPolicy(
      resolveLogoPolicy({
        brandSettings: { configured: true, logoUrl: LOGO },
      }),
    )
    expect(requireLogo).toBe(true)

    // Same policy for validateSchema, collectSchemaQualityIssues, and runQualityGate
    const schema = validateSchema(artifact.html, { expectOrganizationLogo: requireLogo })
    const imageMissing = schema.issues.filter(
      (i) => i.property === 'image' || /missing.*image/i.test(i.message),
    )
    const logoMissing = schema.issues.filter(
      (i) => /logo/i.test(i.property) && /missing/i.test(i.message),
    )
    expect(imageMissing).toHaveLength(0)
    expect(logoMissing).toHaveLength(0)

    const collected = collectSchemaQualityIssues(artifact.html, requireLogo)
    expect(
      collected.filter((i) => /Article:\s*image/i.test(i.title) && /missing/i.test(i.description)),
    ).toHaveLength(0)
    expect(
      collected.filter((i) => /logo/i.test(i.title + i.description) && /missing/i.test(i.description)),
    ).toHaveLength(0)

    const qr = await runQualityGate(artifact.html, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: requireLogo,
    })

    const qgImageMissing = qr.issues.filter(
      (i) => i.category === 'schema' && /Article:\s*image/i.test(i.title),
    )
    const qgLogoMissing = qr.issues.filter(
      (i) => i.category === 'schema' && /logo/i.test(i.title + i.description) && /missing/i.test(i.description),
    )
    expect(qgImageMissing).toHaveLength(0)
    expect(qgLogoMissing).toHaveLength(0)

    // Score board lists Structured Data from the same final HTML
    expect(qr.explainable).toBeDefined()
    expect(qr.articleAfterAutoFix).toContain(HERO)
    expect(qr.articleAfterAutoFix).toContain(LOGO)
  })

  it('shared logo policy: omit when no logo_url — generation/recheck/Fix All agree', async () => {
    const omitPolicy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: null },
    })
    expect(expectOrganizationLogoFromPolicy(omitPolicy)).toBe(false)

    const artifact = buildFinalArticleArtifact({
      proseHtml: prose,
      imageSet: imageSet(),
      schemaInput: { ...schemaFields, organizationLogoUrl: undefined },
    })

    // Recheck / Fix All / generation all pass expectOrganizationLogo: false
    const flag = expectOrganizationLogoFromPolicy(omitPolicy)
    const schema = validateSchema(artifact.html, { expectOrganizationLogo: flag })
    expect(schema.issues.filter((i) => /logo/i.test(i.property + i.message))).toHaveLength(0)

    const qr = await runQualityGate(artifact.html, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: flag,
    })
    expect(
      qr.issues.filter((i) => i.category === 'schema' && /logo/i.test(i.title + i.description)),
    ).toHaveLength(0)
  })

  it('shared logo policy: require when logo_url set — missing logo still surfaces', async () => {
    const requirePolicy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: LOGO },
    })
    const flag = expectOrganizationLogoFromPolicy(requirePolicy)
    expect(flag).toBe(true)

    const artifact = buildFinalArticleArtifact({
      proseHtml: prose,
      imageSet: imageSet(),
      schemaInput: schemaFields,
    })
    // Strip logo from final HTML to simulate the historical “required but absent” case
    const htmlMissingLogo = artifact.html.replace(/,?\s*"logo"\s*:\s*\{[^}]*\}/g, '')

    const qr = await runQualityGate(htmlMissingLogo, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: flag,
    })
    expect(
      qr.issues.some((i) => i.category === 'schema' && /logo/i.test(i.title + i.description)),
    ).toBe(true)
  })

  it('Article.image on final artifact matches a shipped <img>/<figure> URL', () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: prose,
      imageSet: imageSet(),
      schemaInput: schemaFields,
    })
    expect(artifact.html).toMatch(new RegExp(`<img[^>]+src=["']${HERO.replace(/\./g, '\\.')}`))
    expect(artifact.schemaResult.imageUrl).toBe(HERO)
    // Must not keep a stale intermediate image URL
    expect(artifact.html).not.toContain('intermediate-stale.webp')
  })
})
