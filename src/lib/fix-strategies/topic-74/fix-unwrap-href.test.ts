import { describe, expect, it } from 'vitest'
import { unwrapOriginPrefixedHref } from './fix-unwrap-href'

describe('topic 74 unwrapOriginPrefixedHref', () => {
  it('rewrites a straight-quoted origin-prefixed href to the embedded external URL', () => {
    const html = `<p><a href="/https://www.gov.uk/check-mot-history">MOT</a></p>`
    const { html: out, rewritten } = unwrapOriginPrefixedHref(
      html,
      '/https://www.gov.uk/check-mot-history',
      'https://www.gov.uk/check-mot-history',
    )
    expect(rewritten).toBe(1)
    expect(out).toContain('href="https://www.gov.uk/check-mot-history"')
    expect(out).not.toContain('/https://www.gov.uk')
  })

  it('rewrites a curly-quoted origin-prefixed href', () => {
    // Fixture may ship smart quotes around href values (CMS paste).
    const html = `<a href=“https://example.com/https://www.gov.uk/foo”>x</a>`
    const { html: out, rewritten } = unwrapOriginPrefixedHref(
      html,
      'https://example.com/https://www.gov.uk/foo',
      'https://www.gov.uk/foo',
    )
    expect(rewritten).toBeGreaterThanOrEqual(1)
    expect(out).toMatch(/href=["“]https:\/\/www\.gov\.uk\/foo["”]/)
    expect(out).not.toMatch(/example\.com\/https:\/\//)
  })

  it('is a noop when the old href is absent', () => {
    const html = `<a href="/about.html">About</a>`
    const { html: out, rewritten } = unwrapOriginPrefixedHref(
      html,
      '/https://www.gov.uk/x',
      'https://www.gov.uk/x',
    )
    expect(rewritten).toBe(0)
    expect(out).toBe(html)
  })
})
