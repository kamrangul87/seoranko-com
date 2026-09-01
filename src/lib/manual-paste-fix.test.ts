import { describe, expect, it } from 'vitest'
import { applyPasteAndFix } from './manual-paste-fix'
import { computeFixedTitle } from './onpage-fix-values'

describe('manual-paste-fix', () => {
  it('shortens only the title tag in pasted homepage HTML', () => {
    const longTitle =
      'Autodun — UK EV Charging Map, MOT History Check, Electric Vehicle Guides and Tools for Drivers'
    const html = `<!DOCTYPE html><html><head><title>${longTitle}</title></head><body><h1>Welcome</h1><p>Same body text unchanged.</p></body></html>`
    expect(longTitle.length).toBeGreaterThan(60)

    const expected = computeFixedTitle(longTitle)
    const result = applyPasteAndFix({ html, fixKind: 'meta_title' })
    expect(result.ok).toBe(true)
    expect(result.html).toContain(`<title>${expected}</title>`)
    expect(result.html).not.toContain(longTitle)
    expect(result.html).toContain('<h1>Welcome</h1>')
    expect(result.html).toContain('Same body text unchanged.')
  })

  it('inserts sitemap url blocks into pasted sitemap xml', () => {
    const html = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>`
    const entries = `  <url>\n    <loc>https://autodun.com/mot-predictor</loc>\n  </url>`
    const result = applyPasteAndFix({ html, fixKind: 'sitemap_entries', sitemapEntries: entries })
    expect(result.ok).toBe(true)
    expect(result.html).toContain('<loc>https://autodun.com/mot-predictor</loc>')
    expect(result.html).not.toMatch(/<lastmod>/)
  })

  it('replaces only canonical href for autodun blog index.html', () => {
    const pageUrl = 'https://autodun.com/blog/index.html'
    const html = `<!DOCTYPE html><html><head>
  <title>Blog</title>
  <link rel="canonical" href="https://autodun.com/blog/" />
  <meta name="description" content="EV guides">
</head><body><h1>Blog</h1><p>Body unchanged.</p></body></html>`

    const result = applyPasteAndFix({ html, fixKind: 'canonical_tag', canonicalUrl: pageUrl })
    expect(result.ok).toBe(true)
    expect(result.html).toContain(`href="${pageUrl}"`)
    expect(result.html).not.toContain('href="https://autodun.com/blog/"')
    expect(result.html).toContain('<title>Blog</title>')
    expect(result.html).toContain('Body unchanged.')
    expect(result.html).toMatch(/<link rel="canonical" href="https:\/\/autodun\.com\/blog\/index\.html" \/>/)
  })

  it('does not invent canonical tag when missing from pasted HTML', () => {
    const pageUrl = 'https://autodun.com/blog/index.html'
    const html = '<head><title>Blog</title></head>'
    const result = applyPasteAndFix({ html, fixKind: 'canonical_tag', canonicalUrl: pageUrl })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/No canonical tag found/)
    expect(result.suggestedManualLine).toBe(`<link rel="canonical" href="${pageUrl}">`)
    expect(result.html).toBe(html)
  })
})

describe('manual-fix-platform-steps', () => {
  it('wordpress steps for charging-map 404 include real paths', async () => {
    const { platformRedirectSteps } = await import('./manual-fix-platform-steps')
    const steps = platformRedirectSteps('wordpress', {
      fromUrl: 'https://autodun.com/charging-map',
      toUrl: 'https://autodun.com/',
      evidence: 'HTTP 404 at https://autodun.com/charging-map',
      httpStatus: 404,
    })
    expect(steps).toMatch(/Redirection/)
    expect(steps).toContain('/charging-map')
    expect(steps).not.toMatch(/next\.config/)
  })
})
