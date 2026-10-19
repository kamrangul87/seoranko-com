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

  it('noops when href already present', () => {
    const html = `<footer><a href="/contact">Contact</a></footer>`
    const { updated } = addNavOrFooterLink(html, {
      href: '/contact',
      anchorText: 'Contact',
    })
    expect(updated).toBe(0)
  })

  it('inserts into React path: array, not href: array', () => {
    const src = `
const toolLinks = [{ href: "https://ev.example", label: "EV" }];
const internalLinks = [
    { path: "/about", label: "About" },
    { path: "/privacy", label: "Privacy" }];
`
    const { html, updated, target } = addNavOrFooterLink(src, {
      href: '/contact',
      anchorText: 'Contact',
    })
    expect(updated).toBe(1)
    expect(target).toBe('react-nav')
    expect(html).toContain('{ path: "/contact", label: "Contact" }')
    expect(html).toContain('toolLinks = [{ href:')
  })
})

