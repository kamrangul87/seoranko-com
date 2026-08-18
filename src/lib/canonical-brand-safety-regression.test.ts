import { describe, it, expect } from 'vitest'
import { runQualityGate } from './article-quality-gate'
import { buildCanonicalTag } from './canonical-builder'

// Known live regression (publish-route spec): the brand-safety checker
// flagged an article's OWN self-referencing canonical URL as a cross-brand
// link, and its auto-fix DELETED the canonical tag. Reproduces the exact
// reported scenario: brand="autodun", canonical points at autodun.com, but
// registeredLinkDomains is empty (the realistic case — nothing has been
// explicitly registered for this brand yet).
describe('cross-brand-link auto-fix must never touch the self-referencing canonical tag', () => {
  const html = `
    <h1>EV Charger Guide</h1>
    <p>Written by <strong>Kamran Gul</strong>, Founder of Autodun.</p>
    <p>This guide covers ev charger installation in detail with enough real content to pass the word count floor for this regression test, repeated so the gate does not also flag word count as the reason it fails, since that is not what this test is checking for at all here today.</p>
    ${buildCanonicalTag('https://autodun.com/ev-charger')}
  `

  it('does not raise a cross-brand-link issue for the canonical <link> tag', async () => {
    const result = await runQualityGate(html, {
      brand: 'autodun',
      keyword: 'ev charger',
      authorName: 'Kamran Gul',
      registeredLinkDomains: [], // realistic: nothing registered yet for this brand
    })
    const crossBrandOnCanonical = result.issues.filter(
      i => i.category === 'cross-brand-link' && i.location?.includes('rel="canonical"')
    )
    expect(crossBrandOnCanonical).toHaveLength(0)
  })

  it('auto-fix never strips the canonical tag even when other cross-brand links exist', async () => {
    const htmlWithRealCrossBrandLink = `${html}\n<p>See also <a href="https://fitford.com/unrelated">this unrelated fitford page</a>.</p>`
    const result = await runQualityGate(htmlWithRealCrossBrandLink, {
      brand: 'autodun',
      keyword: 'ev charger',
      authorName: 'Kamran Gul',
      registeredLinkDomains: [],
    })
    // The genuinely unrelated cross-brand <a> link should still be caught...
    expect(result.issues.some(i => i.category === 'cross-brand-link')).toBe(true)
    // ...but the canonical tag must survive the auto-fix pass intact.
    expect(result.articleAfterAutoFix).toContain('rel="canonical" href="https://autodun.com/ev-charger"')
  })
})
