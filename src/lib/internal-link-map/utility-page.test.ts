import { describe, expect, it } from 'vitest'
import { isContentPage, isUtilityPage } from './utility-page'

describe('isUtilityPage — path signals', () => {
  it.each([
    '/privacy',
    '/privacy/',
    '/privacy.html',
    '/privacy/index.html',
    '/privacy-policy',
    '/privacy-policy.html',
    '/en/privacy',
    '/cookie',
    '/cookies',
    '/cookies/',
    '/cookie-policy',
    '/cookies-policy.html',
    '/terms',
    '/terms-of-service',
    '/terms-of-use',
    '/terms-and-conditions.html',
    '/legal',
    '/legal/',
    '/disclaimer',
    '/contact',
    '/contact-us',
    '/contact-us.html',
    '/about',
    '/about/',
    '/about-us',
    '/about-us.html',
    '/accessibility',
    '/accessibility-statement',
    '/sitemap',
    '/sitemap.html',
    '/login',
    '/signin',
    '/sign-in',
    '/signup',
    '/sign-up.html',
    '/account',
    '/my-account',
    '/cart',
    '/cart/',
    '/checkout',
    '/checkout.html',
    '/404',
    '/404.html',
    '/search',
    '/search.html',
    '/tag/mot',
    '/tags/ev',
    '/category/guides',
    '/categories/mot/',
    '/author/kamran',
    '/authors/team/index.html',
  ])('classifies %s as utility', (path) => {
    expect(isUtilityPage({ url: `https://autodun.com${path}` })).toBe(true)
    expect(isUtilityPage({ href: path })).toBe(true)
    expect(isContentPage({ url: `https://autodun.com${path}` })).toBe(false)
  })

  it('does not treat articles, tools, or landing pages as utility', () => {
    const content = [
      '/',
      '/index.html',
      '/blog',
      '/blog/',
      '/blog/mot-cost-uk-2026.html',
      '/blog/privacy-laws-uk-2026.html',
      '/blog/about-ev-charging-uk.html',
      '/guides/contactless-payments',
      '/uk-vehicle-data-tools',
      '/ulez-checker-uk',
      '/electric-car-charger-map-uk.html',
    ]
    for (const path of content) {
      expect(isUtilityPage({ url: `https://autodun.com${path}` })).toBe(false)
      expect(isContentPage({ url: `https://autodun.com${path}` })).toBe(true)
    }
  })
})

describe('isUtilityPage — title / H1 signals', () => {
  it('flags footer-only legal pages even when the path is generic', () => {
    expect(
      isUtilityPage({
        url: 'https://autodun.com/info',
        title: 'Privacy Policy',
        h1: 'Privacy Policy',
      }),
    ).toBe(true)
    expect(
      isUtilityPage({
        url: 'https://autodun.com/p',
        title: 'Cookie Policy | Autodun',
        h1: 'Cookie Policy',
      }),
    ).toBe(true)
    expect(
      isUtilityPage({
        url: 'https://autodun.com/legal-hub',
        title: 'Terms of Service',
        h1: 'Terms of Service',
      }),
    ).toBe(true)
  })

  it('flags Autodun-style About and Contact titles', () => {
    expect(
      isUtilityPage({
        url: 'https://autodun.com/about',
        title: 'About Autodun',
        h1: 'About Autodun',
      }),
    ).toBe(true)
    expect(
      isUtilityPage({
        url: 'https://autodun.com/contact',
        title: 'Contact Autodun – Vehicle History &amp; Support Team',
        h1: 'Contact Autodun – Vehicle History & Support Team',
      }),
    ).toBe(true)
  })

  it('does not flag article titles that happen to start with About', () => {
    expect(
      isUtilityPage({
        url: 'https://autodun.com/blog/about-ev-charging-uk.html',
        title: 'About EV charging on UK motorways',
        h1: 'About EV charging on UK motorways',
      }),
    ).toBe(false)
  })
})
