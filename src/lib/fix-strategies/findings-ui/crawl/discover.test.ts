import { describe, expect, it } from 'vitest'
import { extractSameHostLinks } from './discover'

describe('extractSameHostLinks', () => {
  it('does not enqueue origin-prefixed external hrefs into the frontier', () => {
    const html = `
      <a href="/about.html">About</a>
      <a href="/https://www.gov.uk/check-mot-history">MOT (malformed)</a>
      <a href="https://seoranko-fixture.vercel.app/https://www.gov.uk/foo">abs malformed</a>
      <a href=“/https://www.gov.uk/getting-an-mot”>curly malformed</a>
    `
    const links = extractSameHostLinks(
      html,
      'https://seoranko-fixture.vercel.app/',
      'https://seoranko-fixture.vercel.app',
    )
    expect(links).toContain('https://seoranko-fixture.vercel.app/about.html')
    expect(links.every((u) => !/\/https?:\/\//i.test(u))).toBe(true)
    expect(links.every((u) => !/%E2%80%9C/i.test(u))).toBe(true)
  })
})
