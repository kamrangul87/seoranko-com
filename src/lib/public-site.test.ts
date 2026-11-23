import { describe, expect, it } from 'vitest'
import {
  AUTH_ROBOTS,
  MARKETING_SITEMAP_URL,
  PRIVATE_PATH_PREFIXES,
  PUBLIC_SITEMAP_PATHS,
  ROBOTS_DISALLOW_PATHS,
  SITE_ORIGIN,
  absoluteUrl,
  buildRobotsConfig,
  marketingSitemapEntries,
  publicPageMetadata,
} from './public-site'

describe('public marketing site SEO config', () => {
  it('uses the www origin www.seoranko.com (apex 308s to www)', () => {
    expect(SITE_ORIGIN).toBe('https://www.seoranko.com')
    expect(SITE_ORIGIN).not.toBe('https://seoranko.com')
    expect(MARKETING_SITEMAP_URL).toBe('https://www.seoranko.com/sitemap.xml')
  })

  it('lists only public marketing pages in the sitemap', () => {
    expect(PUBLIC_SITEMAP_PATHS).toEqual(
      expect.arrayContaining([
        '/',
        '/pricing',
        '/about',
        '/case-studies/autodun',
        '/privacy',
        '/terms',
      ]),
    )

    for (const path of PUBLIC_SITEMAP_PATHS) {
      for (const prefix of PRIVATE_PATH_PREFIXES) {
        const blocked = path === prefix || path.startsWith(`${prefix}/`)
        expect({ path, prefix, blocked }).toEqual({ path, prefix, blocked: false })
      }
    }
  })

  it('emits absolute sitemap URLs on www.seoranko.com and never dashboard/auth/api', () => {
    const entries = marketingSitemapEntries()
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('https://www.seoranko.com')
    expect(urls).toContain('https://www.seoranko.com/pricing')
    expect(urls).toContain('https://www.seoranko.com/about')
    expect(urls).toContain('https://www.seoranko.com/case-studies/autodun')
    expect(urls).toContain('https://www.seoranko.com/privacy')
    expect(urls).toContain('https://www.seoranko.com/terms')
    expect(urls.some((u) => u.startsWith('https://seoranko.com'))).toBe(false)
    expect(urls.some((u) => u.includes('/dashboard'))).toBe(false)
    expect(urls.some((u) => u.includes('/api'))).toBe(false)
    expect(urls.some((u) => u.includes('/login'))).toBe(false)
    expect(urls.some((u) => u.includes('/signup'))).toBe(false)
  })

  it('always puts https://www.seoranko.com/sitemap.xml first and disallows private areas', () => {
    expect(ROBOTS_DISALLOW_PATHS).toEqual(
      expect.arrayContaining(['/dashboard', '/api', '/login', '/signup', '/auth']),
    )
    const robots = buildRobotsConfig([])
    expect(robots.sitemap).toEqual(['https://www.seoranko.com/sitemap.xml'])
    expect(robots.rules).toEqual({
      userAgent: '*',
      allow: '/',
      disallow: [...ROBOTS_DISALLOW_PATHS],
    })
    const withBrands = buildRobotsConfig([
      'https://blog.seoranko.com/blog/acme/sitemap.xml',
    ])
    expect(withBrands.sitemap[0]).toBe('https://www.seoranko.com/sitemap.xml')
    expect(withBrands.sitemap).toHaveLength(2)
  })

  it('builds self-referencing canonicals and Open Graph basics from a path', () => {
    expect(absoluteUrl('/')).toBe('https://www.seoranko.com')
    expect(absoluteUrl('/pricing')).toBe('https://www.seoranko.com/pricing')
    const meta = publicPageMetadata({
      path: '/about',
      title: 'About — SEORANKO',
      description: 'What SEORANKO does.',
    })
    expect(meta.alternates).toEqual({ canonical: 'https://www.seoranko.com/about' })
    expect(meta.openGraph?.url).toBe('https://www.seoranko.com/about')
    expect(meta.openGraph?.type).toBe('website')
    expect(meta.openGraph?.title).toBe('About — SEORANKO')
    expect(meta.twitter?.card).toBe('summary_large_image')
    expect(AUTH_ROBOTS).toEqual({ index: false, follow: false })
  })
})
