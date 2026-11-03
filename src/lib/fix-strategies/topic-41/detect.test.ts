import { describe, expect, it } from 'vitest'
import { detectFaqSchemaMissing } from './detect'

function page(body: string, head = '<title>FAQ</title>'): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
}

describe('topic 41 — FAQPage JSON-LD missing', () => {
  it('proposes FAQPage JSON-LD for details/summary Q&A', () => {
    const h = page(
      '<h2>Frequently Asked Questions</h2>' +
        '<details><summary>Q1?</summary><p>A1.</p></details>' +
        '<details><summary>Q2?</summary><p>A2.</p></details>',
    )
    const r = detectFaqSchemaMissing({ html: h, pageUrl: 'https://example.com/faq' })
    expect(r.findings.some((f) => f.verdict === 'auto-add-faq-json-ld')).toBe(true)
    const f = r.findings[0]!
    const jl = f.proposed.jsonLd as {
      ['@type']?: string
      mainEntity?: Array<{
        acceptedAnswer?: { text?: string }
      }>
    }
    expect(jl['@type']).toBe('FAQPage')
    const me = (jl.mainEntity ?? []) as Array<{
      acceptedAnswer?: { text?: string }
    }>
    expect(me.length).toBeGreaterThanOrEqual(2)
    expect(me[0].acceptedAnswer.text).toBe('A1.')
  })

  it('suppresses when FAQPage JSON-LD already present', () => {
    const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>`
    const h = page('<h2>FAQ</h2>' + ld)
    const r = detectFaqSchemaMissing({ html: h, pageUrl: 'https://example.com/faq' })
    expect(r.findings).toHaveLength(0)
    expect(r.suppressed.some((s) => s.verdict === 'ok')).toBe(true)
  })
})

