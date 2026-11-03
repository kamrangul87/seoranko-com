import { describe, it, expect } from 'vitest'
import { suggestTitleAndDescription } from './title-meta-suggest'

const page = (head: string, body: string): string =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`

describe('suggestTitleAndDescription', () => {
  it('uses only query tokens present on the page', () => {
    const html = page(
      '<title>EV charging costs UK</title><meta name="description" content="Guide to EV charging costs in the UK.">',
      '<h1>EV charging costs in the UK (2026)</h1><p>Find costs and prices by charger type.</p>',
    )
    const s = suggestTitleAndDescription({
      url: 'https://example.com/ev-charging-costs',
      html,
      queries: ['ev charging costs uk 2026', 'best ev rates usa'],
    })
    expect(s.suggestedTitle).toMatch(/EV charging costs UK/i)
    expect(s.targetedQueries.join(' ')).toMatch(/ev charging costs uk/i)
    // The USA query should be rejected (tokens not present)
    expect(s.targetedQueries.some((q) => /usa/i.test(q))).toBe(false)
  })

  it('respects length caps', () => {
    const html = page('<title>Short</title>', '<p>Some visible text about price and UK 2026.</p>')
    const s = suggestTitleAndDescription({
      url: 'https://example.com/x',
      html,
      queries: ['price uk 2026 price uk 2026 price uk 2026'],
      titleMaxChars: 30,
      descriptionMaxChars: 80,
    })
    expect((s.suggestedTitle || '').length).toBeLessThanOrEqual(30)
    // Suggestion may be null if no improvement; still a valid result
    expect(s.currentTitle).toBe('Short')
  })
})

