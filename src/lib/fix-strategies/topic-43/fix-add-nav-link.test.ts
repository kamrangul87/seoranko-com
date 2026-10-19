import { describe, expect, it } from 'vitest'
import { addNavOrFooterLink, pickAnchorText } from './fix-add-nav-link'

describe('addNavOrFooterLink', () => {
  it('inserts next to the last footer link', () => {
    const html = `<html><body><footer><a href="/about">About</a></footer></body></html>`
    const { html: next, updated, target } = addNavOrFooterLink(html, {
      href: '/contact',
      anchorText: 'Contact',
    })
    expect(updated).toBe(1)
    expect(target).toBe('footer-nav')
    expect(next).toContain('<a href="/contact">Contact</a>')
    expect(next).toMatch(/About<\/a>\s*<a href="\/contact">Contact<\/a>/)
  })

  it('pickAnchorText prefers title', () => {
    expect(
      pickAnchorText({
        pageTitle: 'Contact us',
        pageUrl: 'https://example.com/contact',
      }),
    ).toBe('Contact us')
  })
})
