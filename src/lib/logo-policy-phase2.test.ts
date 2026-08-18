import { describe, it, expect } from 'vitest'
import { validateSchema } from './schema-validator'
import { runQualityGate } from './article-quality-gate'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
} from './quality-gate-policy'

const htmlWithoutLogo = `
<h1>Home EV charger guide</h1>
<p>By Kamran Gul. Installing a home EV charger needs a qualified electrician and a confirmed supply capacity.</p>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"Home EV charger guide","author":{"@type":"Person","name":"Kamran Gul"},"datePublished":"2026-08-18","image":"https://cdn.example.com/hero.webp","publisher":{"@type":"Organization","name":"Example Brand","url":"https://example.com"}}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Example Brand","url":"https://example.com"}
</script>
`

describe('Phase 2 logo policy defaults (recheck/Fix All parity)', () => {
  it('validateSchema does NOT require logo by default', () => {
    const result = validateSchema(htmlWithoutLogo)
    const logoIssues = result.issues.filter(i => /logo/i.test(i.property + i.message))
    expect(logoIssues).toHaveLength(0)
  })

  it('validateSchema still requires logo when expectOrganizationLogo is true', () => {
    const result = validateSchema(htmlWithoutLogo, { expectOrganizationLogo: true })
    const logoIssues = result.issues.filter(i => /logo/i.test(i.property + i.message))
    expect(logoIssues.length).toBeGreaterThan(0)
  })

  it('runQualityGate default matches omit policy when brand has no logo_url', async () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: null },
    })
    expect(expectOrganizationLogoFromPolicy(policy)).toBe(false)

    const qr = await runQualityGate(htmlWithoutLogo, {
      brand: 'Example Brand',
      keyword: 'home EV charger',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 20,
      maxWordCount: 400,
      // omit expectOrganizationLogo — must default to false (Phase 2)
    })
    const logoIssues = qr.issues.filter(
      i => i.category === 'schema' && /logo/i.test(i.title + i.description),
    )
    expect(logoIssues).toHaveLength(0)
  })
})
