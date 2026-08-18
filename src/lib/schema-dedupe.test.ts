import { describe, it, expect } from 'vitest'
import { stripReplaceableJsonLd, countSchemaType, applyGeneratedSchemaToHtml } from './schema-dedupe'
import { injectMissingInternalLinks } from './inject-internal-links'

describe('stripReplaceableJsonLd', () => {
  it('removes duplicate Article JSON-LD leaving body intact', () => {
    const html = `
      <h1>EV Charger</h1>
      <p>Body text</p>
      <script type="application/ld+json">{"@type":"Article","headline":"Wrong"}</script>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
    `
    const stripped = stripReplaceableJsonLd(html)
    expect(countSchemaType(stripped, 'Article')).toBe(0)
    expect(countSchemaType(stripped, 'FAQPage')).toBe(0)
    expect(stripped).toContain('EV Charger')
    expect(stripped).toContain('Body text')
  })
})

describe('applyGeneratedSchemaToHtml', () => {
  it('is idempotent — second apply keeps one Article and one Organization', () => {
    const body = `<h1>Title</h1><p>Body citing gov.uk guidance.</p>`
    const tag = [
      `<script type="application/ld+json">{"@type":"Article","headline":"Title","image":"https://cdn.example.com/h.webp"}</script>`,
      `<script type="application/ld+json">{"@type":"Organization","name":"Brand"}</script>`,
    ].join('\n')
    const once = applyGeneratedSchemaToHtml(
      `${body}\n<script type="application/ld+json">{"@type":"Article","headline":"Stale"}</script>`,
      tag,
    )
    const twice = applyGeneratedSchemaToHtml(once, tag)
    expect(countSchemaType(once, 'Article')).toBe(1)
    expect(countSchemaType(twice, 'Article')).toBe(1)
    expect(countSchemaType(twice, 'Organization')).toBe(1)
    expect(twice).toContain('https://cdn.example.com/h.webp')
    expect(twice).not.toContain('"headline":"Stale"')
  })
})

describe('injectMissingInternalLinks', () => {
  it('wraps plain anchor text in a real href', () => {
    const html = `<p>Check your MOT status with Autodun MOT checker before a long trip.</p>`
    const { html: out, injected } = injectMissingInternalLinks(html, [{
      url: 'https://mot.autodun.com',
      anchorText: 'Autodun MOT checker',
      context: 'MOT tools',
    }])
    expect(injected).toContain('https://mot.autodun.com')
    expect(out).toContain('<a href="https://mot.autodun.com" rel="noopener">Autodun MOT checker</a>')
  })

  it('skips URLs already present as href', () => {
    const html = `<p><a href="https://mot.autodun.com">MOT checker</a></p>`
    const { injected, alreadyPresent } = injectMissingInternalLinks(html, [{
      url: 'https://mot.autodun.com',
      anchorText: 'MOT checker',
      context: '',
    }])
    expect(injected).toHaveLength(0)
    expect(alreadyPresent).toContain('https://mot.autodun.com')
  })
})
