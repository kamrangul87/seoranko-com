import { describe, it, expect } from 'vitest'
import { applyGeneratedSchemaToHtml, countSchemaType, stripReplaceableJsonLd } from './schema-dedupe'
import { generateArticleSchema } from './schema-generator'
import {
  buildFinalArticleArtifact,
  FINAL_ARTIFACT_PIPELINE_ORDER,
} from './final-article-artifact'
import { assertSchemaCompleteness } from './schema-validate'
import { runQualityGate } from './article-quality-gate'
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

function imageSet(opts?: {
  heroUrl?: string
  contentUrls?: string[]
}): ArticleImageSet {
  const heroUrl = opts?.heroUrl ?? 'https://cdn.example.com/hero.webp'
  const contentUrls = opts?.contentUrls ?? ['https://cdn.example.com/c1.webp']
  return {
    hero: img({ id: 'hero', url: heroUrl, width: 1200, height: 630, placement: 'Hero' }),
    content: contentUrls.map((url, i) => img({ id: `c${i}`, url })),
    niche: 'automotive',
    styleDescriptor: 'editorial',
    imageStats: {
      requested: 1 + contentUrls.length,
      generated: 1 + contentUrls.length,
      failures: [],
    },
  }
}

const baseProse = `
<h1>Home EV charger installation guide</h1>
<p>Installing a home EV charger starts with confirming your supply capacity and choosing a unit that matches your vehicle's charge rate.</p>
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
  organizationLogoUrl: 'https://example.com/logo.png',
  market: 'United Kingdom',
}

describe('FINAL_ARTIFACT_PIPELINE_ORDER', () => {
  it('documents Phase 1 order ending in final Quality Gate then save/stream', () => {
    expect([...FINAL_ARTIFACT_PIPELINE_ORDER]).toEqual([
      'prose_transforms',
      'image_injection',
      'final_paragraph_scannability',
      'schema_synchronization',
      'final_quality_gate',
      'final_score_save_stream',
    ])
  })
})

describe('applyGeneratedSchemaToHtml (idempotent sync)', () => {
  it('strips replaceable JSON-LD then appends exactly one Article block', () => {
    const stale = `${baseProse}
<script type="application/ld+json">{"@type":"Article","headline":"Wrong"}</script>
<script type="application/ld+json">{"@type":"Organization","name":"Wrong Org"}</script>`
    const generated = generateArticleSchema({
      ...schemaFields,
      imageUrl: 'https://cdn.example.com/hero.webp',
      wordCount: 120,
    })
    const once = applyGeneratedSchemaToHtml(stale, generated.combinedScriptTag)
    expect(countSchemaType(once, 'Article')).toBe(1)
    expect(countSchemaType(once, 'Organization')).toBe(1)
    expect(once).toContain('https://cdn.example.com/hero.webp')
    expect(once).not.toContain('"headline":"Wrong"')

    const twice = applyGeneratedSchemaToHtml(once, generated.combinedScriptTag)
    expect(countSchemaType(twice, 'Article')).toBe(1)
    expect(countSchemaType(twice, 'Organization')).toBe(1)
    expect(countSchemaType(twice, 'BreadcrumbList')).toBe(1)
  })
})

describe('buildFinalArticleArtifact', () => {
  it('sets Article.image to the shipped hero URL after injection', () => {
    const set = imageSet({ heroUrl: 'https://cdn.example.com/hero.webp' })
    const result = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: set,
      schemaInput: schemaFields,
    })
    expect(result.primaryImageUrl).toBe('https://cdn.example.com/hero.webp')
    expect(result.schemaResult.imageUrl).toBe('https://cdn.example.com/hero.webp')
    expect(result.html).toContain('https://cdn.example.com/hero.webp')
    expect(result.html).toMatch(/<figure[\s>]/i)
    expect(countSchemaType(result.html, 'Article')).toBe(1)
  })

  it('uses first content image for Article.image when hero URL is empty', () => {
    const set = imageSet({
      heroUrl: '',
      contentUrls: ['https://cdn.example.com/content-only.webp'],
    })
    // Empty hero skips hero figure; content images still inject when H2s exist.
    const result = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: set,
      schemaInput: schemaFields,
    })
    expect(result.primaryImageUrl).toBe('https://cdn.example.com/content-only.webp')
    expect(result.schemaResult.imageUrl).toBe('https://cdn.example.com/content-only.webp')
    expect(result.html).toContain('"image": "https://cdn.example.com/content-only.webp"')
  })

  it('hard-completeness on synced artifact: image present → not blocked for image', () => {
    const result = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: imageSet(),
      schemaInput: schemaFields,
    })
    const hard = assertSchemaCompleteness({
      imageUrl: result.schemaResult.imageUrl,
      organizationLogoUrl: result.schemaResult.organizationLogoUrl,
      logoOmittedReason: result.schemaResult.logoOmittedReason,
      hasBrandSettingsConfigured: true,
    })
    expect(hard.blocked).toBe(false)
    expect(hard.reasons).toHaveLength(0)
  })

  it('does not use an intermediate pre-image snapshot for schema image', () => {
    const staleSchema = generateArticleSchema({
      ...schemaFields,
      imageUrl: undefined,
      wordCount: 80,
    })
    const proseWithStaleSchema = applyGeneratedSchemaToHtml(baseProse, staleSchema.combinedScriptTag)
    expect(proseWithStaleSchema).not.toContain('"image":')

    const result = buildFinalArticleArtifact({
      proseHtml: proseWithStaleSchema,
      imageSet: imageSet({ heroUrl: 'https://cdn.example.com/real-hero.webp' }),
      schemaInput: schemaFields,
    })
    expect(stripReplaceableJsonLd(result.html) === result.html).toBe(false)
    expect(result.schemaResult.imageUrl).toBe('https://cdn.example.com/real-hero.webp')
    expect(countSchemaType(result.html, 'Article')).toBe(1)
    expect(result.html.match(/"@type": "Article"/g)?.length).toBe(1)
  })
})

describe('final Quality Gate on synchronized artifact (Phase 1)', () => {
  it('scores schema against the same HTML that carries injected images + JSON-LD', async () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: imageSet(),
      schemaInput: schemaFields,
    })
    const qr = await runQualityGate(artifact.html, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: true,
    })
    const schemaImageWarnings = qr.issues.filter(
      (i) => i.category === 'schema' && /Article:\s*image/i.test(i.title),
    )
    expect(schemaImageWarnings).toHaveLength(0)
    // Same artifact string identity for QG input — invariant for callers:
    expect(qr.articleAfterAutoFix).toContain('https://cdn.example.com/hero.webp')
    expect(countSchemaType(qr.articleAfterAutoFix, 'Article')).toBe(1)
  })

  it('still surfaces schema logo warnings when logo is required but absent (no score gaming)', async () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: imageSet(),
      schemaInput: schemaFields,
    })
    // Simulate final HTML that lost Organization/publisher.logo — QG must
    // still warn when expectOrganizationLogo is true (no score gaming).
    const htmlMissingLogo = artifact.html.replace(/,?\s*"logo"\s*:\s*"[^"]*"/g, '')
    const qr = await runQualityGate(htmlMissingLogo, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: true,
    })
    const logoIssues = qr.issues.filter(
      (i) => i.category === 'schema' && /logo/i.test(i.title + i.description),
    )
    expect(logoIssues.length).toBeGreaterThan(0)
  })
})
