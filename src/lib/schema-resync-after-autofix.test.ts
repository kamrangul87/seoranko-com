import { describe, it, expect } from 'vitest'
import {
  runQualityGate,
  collectSchemaQualityIssues,
} from './article-quality-gate'
import { validateSchema } from './schema-validator'

const BASE_OPTS = {
  brand: 'autodun',
  keyword: 'home EV charger installation UK',
  authorName: 'Kamran Gul',
  registeredLinkDomains: ['autodun.com'],
  minWordCount: 50,
  expectOrganizationLogo: false,
}

const ARTICLE_SHELL = (body: string, schemas = '') => `
<html><head><title>Home EV charger installation UK | autodun</title></head>
<body><article>
<h1>Home EV charger installation UK</h1>
<p>Written by Kamran Gul of autodun. Home EV charger installation UK depends on your meter and DNO.</p>
${body}
<h2>Bottom line</h2>
<p>Home EV charger installation UK is manageable when you check supply capacity first.</p>
</article></body></html>
${schemas}
`

const VALID_ARTICLE_SCHEMA = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Home EV charger installation UK",
  "author": { "@type": "Person", "name": "Kamran Gul" },
  "datePublished": "2026-08-18T12:00:00Z",
  "dateModified": "2026-08-18T12:00:00Z",
  "image": "https://example.supabase.co/storage/v1/object/public/article-images/hero.webp",
  "publisher": {
    "@type": "Organization",
    "name": "autodun",
    "url": "https://autodun.com"
  }
}
</script>
`

const TWO_FAQS = `
<div class="faq-item">
  <h3>Does home EV charger installation UK need Part P?</h3>
  <p>Yes. A competent person scheme must certify the new circuit.</p>
</div>
<div class="faq-item">
  <h3>How long does home EV charger installation UK take?</h3>
  <p>A straightforward job finishes in a few hours once capacity is confirmed.</p>
</div>
`

describe('collectSchemaQualityIssues', () => {
  it('flags FAQ parity when visible FAQs exist without FAQPage', () => {
    const html = ARTICLE_SHELL(TWO_FAQS, VALID_ARTICLE_SCHEMA)
    const issues = collectSchemaQualityIssues(html, false)
    expect(issues.some(i => i.id === 'schema-faq-parity')).toBe(true)
  })

  it('does not flag FAQ parity when FAQPage is present', () => {
    const faqSchema = `
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
  {"@type":"Question","name":"Q1?","acceptedAnswer":{"@type":"Answer","text":"A1"}},
  {"@type":"Question","name":"Q2?","acceptedAnswer":{"@type":"Answer","text":"A2"}}
]}
</script>`
    const html = ARTICLE_SHELL(TWO_FAQS, VALID_ARTICLE_SCHEMA + faqSchema)
    const issues = collectSchemaQualityIssues(html, false)
    expect(issues.some(i => i.id === 'schema-faq-parity')).toBe(false)
  })
})

describe('schema re-validate after QG autofix', () => {
  it('clears schema-faq-parity from final issues after FAQPage autofix inject', async () => {
    const html = ARTICLE_SHELL(TWO_FAQS, VALID_ARTICLE_SCHEMA)
    // Pre-autofix snapshot still has the parity gap
    expect(
      collectSchemaQualityIssues(html, false).some(i => i.id === 'schema-faq-parity'),
    ).toBe(true)

    const qr = await runQualityGate(html, BASE_OPTS)

    expect(qr.articleAfterAutoFix).toMatch(/"@type"\s*:\s*"FAQPage"/)
    expect(qr.issues.some(i => i.id === 'schema-faq-parity')).toBe(false)
    expect(qr.autoFixedCount).toBeGreaterThanOrEqual(1)

    // Fresh validateSchema on returned HTML must also see FAQPage
    const post = validateSchema(qr.articleAfterAutoFix, { expectOrganizationLogo: false })
    expect(post.schemasFound).toContain('FAQPage')
    expect(post.schemasFound).toContain('Article')
  })

  it('final schema issues match articleAfterAutoFix, not the pre-autofix snapshot', async () => {
    const html = ARTICLE_SHELL(TWO_FAQS, VALID_ARTICLE_SCHEMA)
    const qr = await runQualityGate(html, BASE_OPTS)

    const fromReturnedHtml = collectSchemaQualityIssues(
      qr.articleAfterAutoFix,
      false,
    ).map(i => i.id).sort()
    const fromGate = qr.issues
      .filter(i => i.category === 'schema')
      .map(i => i.id)
      .sort()

    expect(fromGate).toEqual(fromReturnedHtml)
    expect(fromGate).not.toContain('schema-faq-parity')
  })

  it('still reports real schema errors that autofix does not fix', async () => {
    // Article schema missing required headline — autofix does not invent it
    const brokenArticle = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "author": { "@type": "Person", "name": "Kamran Gul" },
  "datePublished": "2026-08-18T12:00:00Z"
}
</script>`
    const html = ARTICLE_SHELL(
      '<p>Home EV charger installation UK needs a load assessment.</p>',
      brokenArticle,
    )
    const qr = await runQualityGate(html, BASE_OPTS)
    const schemaIssues = qr.issues.filter(i => i.category === 'schema')
    expect(schemaIssues.some(i => /headline/i.test(i.id) || /headline/i.test(i.title))).toBe(true)

    // Same finding on the returned HTML
    const refreshed = collectSchemaQualityIssues(qr.articleAfterAutoFix, false)
    expect(refreshed.some(i => /headline/i.test(i.id) || /headline/i.test(i.title))).toBe(true)
  })

  it('does not leave a stale FAQ parity critical after successful inject (score honesty)', async () => {
    const html = ARTICLE_SHELL(TWO_FAQS, VALID_ARTICLE_SCHEMA)
    const qr = await runQualityGate(html, BASE_OPTS)
    const faqCriticals = qr.issues.filter(
      i => i.id === 'schema-faq-parity' && i.severity === 'critical',
    )
    expect(faqCriticals).toHaveLength(0)
    // Critical count must not still charge −20 for a gap that autofix closed
    expect(qr.blockers.some(b => /FAQPage schema missing/i.test(b))).toBe(false)
  })
})
