import { describe, it, expect } from 'vitest'
import { applyGeneratedSchemaToHtml, countSchemaType, stripReplaceableJsonLd } from './schema-dedupe'
import { generateArticleSchema } from './schema-generator'
import {
  buildFinalArticleArtifact,
  FINAL_ARTIFACT_PIPELINE_ORDER,
} from './final-article-artifact'
import { assertSchemaCompleteness } from './schema-validate'
import { runQualityGate } from './article-quality-gate'
import { pickPrimaryShippedImageUrlFromHtml } from './shipped-image-url'
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

describe('Phase 1 regression — Article.image + schema + final QG', () => {
  it('1. hero image exists → Article.image is the shipped hero URL', () => {
    const set = imageSet({ heroUrl: 'https://cdn.example.com/hero.webp' })
    const result = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: set,
      schemaInput: schemaFields,
    })
    expect(result.primaryImageUrl).toBe('https://cdn.example.com/hero.webp')
    expect(result.primaryImageWidth).toBe(1200)
    expect(result.schemaResult.imageUrl).toBe('https://cdn.example.com/hero.webp')
    expect(result.html).toContain('https://cdn.example.com/hero.webp')
    expect(result.html).toMatch(/<figure[\s>]/i)
    expect(result.html).toContain('"image": [')
    expect(result.html).toContain('"https://cdn.example.com/hero.webp"')
  })

  it('2. hero image fails but content image exists → Article.image uses content image', () => {
    const set = imageSet({
      heroUrl: '',
      contentUrls: ['https://cdn.example.com/content-only.webp'],
    })
    const result = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: set,
      schemaInput: schemaFields,
    })
    expect(result.primaryImageUrl).toBe('https://cdn.example.com/content-only.webp')
    expect(result.primaryImageWidth).toBe(800)
    expect(result.schemaResult.imageUrl).toBe('https://cdn.example.com/content-only.webp')
    expect(result.html).toContain('"image": [')
    expect(result.html).toContain('"https://cdn.example.com/content-only.webp"')
    expect(result.html).not.toContain('hero.webp')
  })

  it('2b. hero URL claimed by image-set but not present in HTML → no Article.image from that URL', () => {
    // Simulate hand-off failure path: prose has no figures; image-set still
    // lists a hero. Article.image must not invent a URL that never shipped.
    const proseOnly = baseProse
    const primary = pickPrimaryShippedImageUrlFromHtml(proseOnly, {
      heroUrl: 'https://cdn.example.com/never-injected.webp',
      contentUrls: [],
    })
    expect(primary).toBeUndefined()
  })

  it('3. final HTML contains image → Quality Gate does not report missing Article.image', async () => {
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
  })

  it('3b. M06: primary image under 1200px wide is flagged when width is passed to the gate', async () => {
    const set = imageSet({
      heroUrl: '',
      contentUrls: ['https://cdn.example.com/content-only.webp'],
    })
    const artifact = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: set,
      schemaInput: schemaFields,
    })
    expect(artifact.primaryImageWidth).toBe(800)
    const qr = await runQualityGate(artifact.html, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: true,
      primaryImageWidth: artifact.primaryImageWidth,
    })
    const widthIssue = qr.issues.find((i) => i.id === 'schema-Article-image-width')
    expect(widthIssue).toBeTruthy()
    expect(widthIssue!.severity).toBe('critical')
    expect(widthIssue!.description).toContain('800px')
  })

  it('3c. M06: does not fire when primaryImageWidth is unknown (undefined)', async () => {
    const qr = await runQualityGate(baseProse + '<img src="https://cdn.example.com/x.webp">', {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
    })
    const widthIssue = qr.issues.find((i) => i.id === 'schema-Article-image-width')
    expect(widthIssue).toBeUndefined()
  })

  it('3d. M06: a 1200px+ hero image is not flagged', async () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: imageSet(),
      schemaInput: schemaFields,
    })
    expect(artifact.primaryImageWidth).toBe(1200)
    const qr = await runQualityGate(artifact.html, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: true,
      primaryImageWidth: artifact.primaryImageWidth,
    })
    const widthIssue = qr.issues.find((i) => i.id === 'schema-Article-image-width')
    expect(widthIssue).toBeUndefined()
  })

  it('4. duplicate Article JSON-LD does not remain after schema sync', () => {
    const stale = `${baseProse}
<script type="application/ld+json">{"@type":"Article","headline":"Wrong"}</script>
<script type="application/ld+json">{"@type":"Article","headline":"Also Wrong"}</script>
<script type="application/ld+json">{"@type":"Organization","name":"Wrong Org"}</script>`
    const result = buildFinalArticleArtifact({
      proseHtml: stale,
      imageSet: imageSet({ heroUrl: 'https://cdn.example.com/hero.webp' }),
      schemaInput: schemaFields,
    })
    expect(countSchemaType(result.html, 'Article')).toBe(1)
    expect(countSchemaType(result.html, 'Organization')).toBe(1)
    expect(result.html).not.toContain('"headline":"Wrong"')
    expect(result.html).not.toContain('"headline":"Also Wrong"')
    // Idempotent second sync
    const again = applyGeneratedSchemaToHtml(result.html, result.schemaResult.combinedScriptTag)
    expect(countSchemaType(again, 'Article')).toBe(1)
  })

  it('5. final Quality Gate validates the final HTML after image injection', async () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: imageSet({ heroUrl: 'https://cdn.example.com/post-inject-hero.webp' }),
      schemaInput: schemaFields,
    })
    // Gate must see injected figures + synced Article.image — never a
    // pre-image intermediate snapshot.
    expect(artifact.html).toMatch(/<figure[\s>]/i)
    expect(artifact.html).toContain('https://cdn.example.com/post-inject-hero.webp')

    const qr = await runQualityGate(artifact.html, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: true,
    })
    expect(qr.articleAfterAutoFix).toContain('https://cdn.example.com/post-inject-hero.webp')
    expect(countSchemaType(qr.articleAfterAutoFix, 'Article')).toBe(1)
    const missingImage = qr.issues.filter(
      (i) => i.category === 'schema' && /Article:\s*image/i.test(i.title),
    )
    expect(missingImage).toHaveLength(0)
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

  it('still surfaces schema logo warnings when logo is required but absent (no score gaming)', async () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: baseProse,
      imageSet: imageSet(),
      schemaInput: schemaFields,
    })
    const htmlMissingLogo = artifact.html.replace(/,?\s*"logo"\s*:\s*\{[^}]*\}/g, '')
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

  it('replaces stale pre-image schema so Article.image matches injected hero', () => {
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
  })
})

