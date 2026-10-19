import { describe, expect, it } from 'vitest'
import {
  ensureNextPageMetadataCanonical,
  ensurePageSelfCanonical,
  setHeadCanonicalHref,
} from './fix-repoint-canonical'

describe('ensurePageSelfCanonical', () => {
  it('rewrites an existing HTML canonical', () => {
    const html =
      '<html><head><link rel="canonical" href="https://example.com/"></head><body></body></html>'
    const r = ensurePageSelfCanonical(
      html,
      'app/privacy.html',
      'https://example.com/privacy',
    )
    expect(r.updated).toBe(1)
    expect(r.content).toContain('href="https://example.com/privacy"')
    expect(r.content).not.toContain('href="https://example.com/"')
  })

  it('inserts a page-level canonical when the file has none (layout-inherited)', () => {
    const html = '<html><head><title>Privacy</title></head><body></body></html>'
    const r = ensurePageSelfCanonical(
      html,
      'privacy.html',
      'https://example.com/privacy',
    )
    expect(r.updated).toBe(1)
    expect(r.content).toMatch(
      /rel=["']canonical["'][^>]*href=["']https:\/\/example\.com\/privacy["']/,
    )
  })

  it('sets metadata.alternates.canonical on a Next.js page module', () => {
    const src = `export default function Page() { return null }\n`
    const r = ensureNextPageMetadataCanonical(
      src,
      'https://example.com/privacy',
    )
    expect(r.updated).toBe(1)
    expect(r.content).toContain('alternates: { canonical: "https://example.com/privacy" }')
    expect(r.content).toContain('export default function Page')
  })

  it('setHeadCanonicalHref is idempotent for matching href', () => {
    const html =
      '<link rel="canonical" href="https://example.com/privacy">'
    const r = setHeadCanonicalHref(html, 'https://example.com/privacy')
    expect(r.updated).toBe(1)
    expect(r.html).toContain('https://example.com/privacy')
  })
})
