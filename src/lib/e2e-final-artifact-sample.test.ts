import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { buildFinalArticleArtifact } from './final-article-artifact'
import { runQualityGate } from './article-quality-gate'
import { scrubInsertionCorruption, hasInsertionCorruption } from './sentence-integrity'
import { assertImageUrlsPreserved } from './html-text-transform'
import { detectStaleYearReferences, extractHeadingTexts } from './dated-claim-detector'
import { countSchemaType } from './schema-dedupe'
import type { ArticleImageSet, GeneratedImage } from './image-generator'

const HERO = 'https://ddfboapzwclecbdjoqex.supabase.co/storage/v1/object/public/article-images/e2e-hero.webp'
const C1 = 'https://ddfboapzwclecbdjoqex.supabase.co/storage/v1/object/public/article-images/e2e-c1.webp'

function img(p: Partial<GeneratedImage> & { id: string; url: string }): GeneratedImage {
  return {
    width: 800, height: 533, alt: p.alt || 'alt', caption: p.caption || 'caption',
    placement: 'content', prompt: 'prompt', ...p,
  }
}

const prose = `
<!-- META: A practical 2026 guide to choosing and installing a home EV charger safely. -->
<h1>Home EV charger installation guide</h1>
<p>By Kamran Gul. Installing a home EV charger starts with confirming your supply capacity and choosing a unit that matches your vehicle's onboard charger rate.</p>
<p>Most UK EVs currently accept between 50 kW and 150 kW on DC rapid networks, while home wallboxes typically deliver 7 kW to 22 kW depending on your supply.</p>
<p>Book a qualified installer early. After fitting, test the unit and register it with your network operator where local rules require notification.</p>
<h2>Costs, permits, and grants in 2026</h2>
<p>Permit rules vary by location. Always check official guidance before work begins, and keep written quotes that separate hardware, labour, and any grant deductions.</p>
<p>Ask the installer to confirm cable routes, isolator placement, and whether your consumer unit needs an upgrade before they order the charger.</p>
<h2>Choosing the right wallbox</h2>
<p>Match tethered versus socketed designs to how you park. Prefer units with scheduled charging, load balancing, and a clear warranty that covers both parts and labour.</p>
<p>If you share a driveway or live in a flat, check landlord and parking permissions before committing to a specific brand or mounting location.</p>
<h2>Frequently Asked Questions</h2>
<div class="faq-item"><h3>Do I need planning permission?</h3><p>Often no for a typical house wallbox, but flats, listed buildings, and conservation areas can differ — check locally.</p></div>
<div class="faq-item"><h3>How long does installation take?</h3><p>A straightforward install is often a half-day once parts and isolator arrangements are confirmed.</p></div>
`

describe('E2E final-artifact sample (mechanical pipeline)', () => {
  it('builds, gates, and writes a canonical artifact for human review', async () => {
    const imageSet: ArticleImageSet = {
      hero: img({ id: 'hero', url: HERO, width: 1200, height: 630, placement: 'Hero', alt: 'Home wallbox on a brick wall' }),
      content: [img({ id: 'c1', url: C1, alt: 'Installer checking a consumer unit' })],
      niche: 'automotive',
      styleDescriptor: 'editorial automotive',
      imageStats: { requested: 2, generated: 2, failures: [] },
    }

    const artifact = buildFinalArticleArtifact({
      proseHtml: prose,
      imageSet,
      schemaInput: {
        title: 'Home EV charger installation guide',
        description: 'A practical 2026 guide to choosing and installing a home EV charger safely.',
        keyword: 'home EV charger installation',
        authorName: 'Kamran Gul',
        publishDate: '2026-08-18T12:00:00.000Z',
        dateModified: '2026-08-18T12:00:00.000Z',
        articleUrl: 'https://example.com/blog/home-ev-charger-installation',
        organizationName: 'Example Brand',
        organizationUrl: 'https://example.com',
        organizationLogoUrl: 'https://example.com/logo.png',
        market: 'United Kingdom',
        faqs: [
          { question: 'Do I need planning permission?', answer: 'Often no for a typical house wallbox, but flats, listed buildings, and conservation areas can differ — check locally.' },
          { question: 'How long does installation take?', answer: 'A straightforward install is often a half-day once parts and isolator arrangements are confirmed.' },
        ],
      },
    })

    expect(artifact.primaryImageUrl).toBe(HERO)
    expect(artifact.schemaResult.imageUrl).toBe(HERO)
    expect(countSchemaType(artifact.html, 'Article')).toBe(1)
    expect(hasInsertionCorruption(artifact.html)).toBe(false)

    // Stale-year check on this sample (headings say 2026 — publish year 2026 → clean)
    const stale = detectStaleYearReferences(
      {
        title: 'Home EV charger installation guide',
        headings: extractHeadingTexts(artifact.html),
        metaDescription: 'A practical 2026 guide to choosing and installing a home EV charger safely.',
      },
      2026,
    )
    expect(stale).toHaveLength(0)

    const qr = await runQualityGate(artifact.html, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 80,
      maxWordCount: 800,
      expectOrganizationLogo: true,
    })

    let finalHtml = qr.articleAfterAutoFix
    const beforeScrub = finalHtml
    finalHtml = scrubInsertionCorruption(finalHtml).html
    assertImageUrlsPreserved(beforeScrub, finalHtml)
    assertImageUrlsPreserved(artifact.html, finalHtml)

    // Must still contain full Supabase hostnames after QG autofix + scrub
    expect(finalHtml.match(/supabase\.co/g)?.length).toBeGreaterThanOrEqual(2)
    expect(finalHtml).toContain(HERO)
    expect(finalHtml).toContain('"image": "https://ddfboapzwclecbdjoqex.supabase.co')

    const outDir = process.env.CURSOR_ARTIFACTS_DIR || '/tmp'
    mkdirSync(outDir, { recursive: true })
    const report = {
      generatedAt: new Date().toISOString(),
      note: 'Mechanical final-artifact pipeline sample (no Claude — ANTHROPIC_API_KEY unavailable in this agent env). Same order as article-v2 Phase 1: inject → split → schema sync → QG → scrub.',
      primaryImageUrl: artifact.primaryImageUrl,
      schemaImageUrl: artifact.schemaResult.imageUrl,
      qualityGate: {
        score: qr.score,
        passed: qr.passed,
        readyToPublish: qr.readyToPublish,
        criticalCount: qr.criticalCount,
        warningCount: qr.warningCount,
        autoFixedCount: qr.autoFixedCount,
        issues: qr.issues.map(i => ({ id: i.id, severity: i.severity, category: i.category, title: i.title })),
      },
      articleCount: countSchemaType(finalHtml, 'Article'),
      supabaseUrlOccurrences: (finalHtml.match(/supabase\.co/g) || []).length,
    }
    writeFileSync(`${outDir}/e2e-final-artifact-report.json`, JSON.stringify(report, null, 2))
    writeFileSync(`${outDir}/e2e-final-artifact.html`, finalHtml)

    expect(qr.issues.some(i => /Article:\s*image/i.test(i.title))).toBe(false)
  })
})
