import { describe, expect, it } from 'vitest'
import { findPrivacyPage } from './policy-diff'

describe('findPrivacyPage', () => {
  it('resolves footer /privacy.html when home URL has no trailing slash', () => {
    const hit = findPrivacyPage([
      {
        url: 'https://seoranko-fixture.vercel.app',
        html: '<footer><a href="/privacy.html">Privacy policy</a></footer>',
      },
      {
        url: 'https://seoranko-fixture.vercel.app/privacy.html',
        html: '<h1>Privacy</h1>',
      },
    ])
    expect(hit?.discoveredVia).toBe('footer_link')
    expect(hit?.pageUrl).toBe('https://seoranko-fixture.vercel.app/privacy.html')
  })

  it('resolves footer link when home has trailing slash and privacy does not', () => {
    const hit = findPrivacyPage([
      {
        url: 'https://example.com/',
        html: '<a href="/privacy">Privacy</a>',
      },
      {
        url: 'https://example.com/privacy',
        html: '<h1>Privacy</h1>',
      },
    ])
    expect(hit?.pageUrl).toMatch(/\/privacy$/)
  })

  it('falls back to path heuristic when footer target is not in crawl set', () => {
    const hit = findPrivacyPage([
      {
        url: 'https://example.com/',
        html: '<a href="/privacy.html">Privacy</a>',
      },
      {
        url: 'https://example.com/privacy.html',
        html: '<h1>Privacy</h1>',
      },
    ])
    expect(hit).not.toBeNull()
    expect(hit!.pageUrl).toContain('privacy')
  })
})
