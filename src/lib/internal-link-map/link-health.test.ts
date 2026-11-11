import { describe, expect, it } from 'vitest'
import { collectInContentInlinkKeys, detectLinkHealthIssues } from './link-health'
import type { CrawlLinkEdge } from './types'

const ORIGIN = 'https://example.com'

function edge(
  sourcePath: string,
  targetPath: string,
  extra: Partial<CrawlLinkEdge> = {},
): CrawlLinkEdge {
  return {
    sourceUrl: `${ORIGIN}${sourcePath}`,
    targetUrl: `${ORIGIN}${targetPath}`,
    hrefRaw: targetPath,
    anchorText: extra.anchorText ?? 'Existing',
    isNofollow: extra.isNofollow ?? false,
    targetHttpStatus: extra.targetHttpStatus ?? 200,
    targetFinalUrl: extra.targetFinalUrl ?? `${ORIGIN}${targetPath}`,
    isRedirect: extra.isRedirect ?? false,
  }
}

const ORPHAN_HTML = `<!doctype html><html><body>
<main><article><h1>Lonely guide</h1><p>No in-content links here.</p></article></main>
</body></html>`

const HOME_HTML = `<!doctype html><html><body>
<nav><a href="/lonely">Lonely guide</a></nav>
<main><article><h1>Home</h1><p>Welcome.</p></article></main>
<footer><a href="/lonely">Lonely guide</a></footer>
</body></html>`

const SOURCE_HTML = `<!doctype html><html><body>
<main><article>
  <h1>MOT cost</h1>
  <p><a href="/gone">click here</a></p>
  <p><a href="/old">MOT history check</a></p>
  <p><a href="/old">MOT history check</a></p>
  <p><a href="https://example.com/about">https://example.com/about</a></p>
</article></main>
</body></html>`

describe('detectLinkHealthIssues', () => {
  it('flags broken, redirect, duplicate, generic, bare-URL, footer-only orphan, and too many outlinks', () => {
    const many = Array.from({ length: 90 }, (_, i) =>
      edge('/blog/mot-cost-uk-2026', `/blog/p-${i}`, { anchorText: `Post ${i}` }),
    )
    const issues = detectLinkHealthIssues({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        {
          url: `${ORIGIN}/`,
          title: 'Home',
          h1: 'Home',
          html: HOME_HTML,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/lonely`,
          title: 'Lonely guide',
          h1: 'Lonely guide',
          html: ORPHAN_HTML,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/blog/mot-cost-uk-2026`,
          title: 'MOT cost UK 2026',
          h1: 'MOT cost UK 2026',
          html: SOURCE_HTML,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/gone`,
          title: 'Gone',
          h1: 'Gone',
          html: null,
          httpStatus: 404,
        },
        {
          url: `${ORIGIN}/old`,
          title: 'Old MOT history',
          h1: 'Old MOT history',
          html: null,
          httpStatus: 301,
          finalUrl: `${ORIGIN}/blog/mot-history-check-uk`,
        },
        {
          url: `${ORIGIN}/about`,
          title: 'About',
          h1: 'About',
          html: null,
          httpStatus: 200,
        },
      ],
      edges: [
        edge('/', '/lonely', { anchorText: 'Lonely guide' }),
        edge('/blog/mot-cost-uk-2026', '/gone', {
          anchorText: 'click here',
          targetHttpStatus: 404,
        }),
        edge('/blog/mot-cost-uk-2026', '/old', {
          anchorText: 'MOT history check',
          targetHttpStatus: 301,
          isRedirect: true,
          targetFinalUrl: `${ORIGIN}/blog/mot-history-check-uk`,
        }),
        edge('/blog/mot-cost-uk-2026', '/old', {
          anchorText: 'MOT history check',
          targetHttpStatus: 301,
          isRedirect: true,
          targetFinalUrl: `${ORIGIN}/blog/mot-history-check-uk`,
        }),
        edge('/blog/mot-cost-uk-2026', '/about', {
          anchorText: 'https://example.com/about',
        }),
        ...many,
      ],
      htmlByUrl: {
        [`${ORIGIN}/`]: HOME_HTML,
        [`${ORIGIN}/lonely`]: ORPHAN_HTML,
        [`${ORIGIN}/blog/mot-cost-uk-2026`]: SOURCE_HTML,
      },
    })

    const kinds = issues.map((i) => i.kind)
    expect(kinds).toContain('broken')
    expect(kinds).toContain('redirect')
    expect(kinds).toContain('duplicate')
    expect(kinds).toContain('generic-anchor')
    expect(kinds).toContain('bare-url-anchor')
    expect(kinds).toContain('orphan-footer-only')
    expect(kinds).toContain('too-many-outlinks')

    const broken = issues.find((i) => i.kind === 'broken')
    expect(broken?.mechanical).toBe(true)
    expect(broken?.hint.toLowerCase()).toMatch(/remove/)
    expect(broken?.neverAutoMerge).toBe(true)

    const redirect = issues.find((i) => i.kind === 'redirect')
    expect(redirect?.mechanical).toBe(true)
    expect(redirect?.hint.toLowerCase()).toMatch(/rewrite|final/)

    const generic = issues.find((i) => i.kind === 'generic-anchor')
    expect(generic?.mechanical).toBe(false)
    expect(generic?.hint.toLowerCase()).toMatch(/descriptive|click here|read more/)

    const orphan = issues.find((i) => i.kind === 'orphan-footer-only')
    expect(orphan?.mechanical).toBe(true)
    expect(orphan?.hint.toLowerCase()).toMatch(/related|article|footer/)

    const tooMany = issues.find((i) => i.kind === 'too-many-outlinks')
    expect(tooMany?.mechanical).toBe(false)
  })

  it('does not flag utility pages as footer-only orphans', () => {
    const privacyHtml = `<!doctype html><html><body>
<main><h1>Privacy Policy</h1><p>How we use data.</p></main>
</body></html>`
    const homeHtml = `<!doctype html><html><body>
<nav><a href="/privacy">Privacy Policy</a></nav>
<main><article><h1>Home</h1></article></main>
<footer><a href="/privacy">Privacy Policy</a><a href="/lonely">Lonely guide</a></footer>
</body></html>`
    const issues = detectLinkHealthIssues({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        {
          url: `${ORIGIN}/`,
          title: 'Home',
          h1: 'Home',
          html: homeHtml,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/privacy`,
          title: 'Privacy Policy',
          h1: 'Privacy Policy',
          html: privacyHtml,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/lonely`,
          title: 'Lonely guide',
          h1: 'Lonely guide',
          html: ORPHAN_HTML,
          httpStatus: 200,
        },
      ],
      edges: [
        edge('/', '/privacy', { anchorText: 'Privacy Policy' }),
        edge('/', '/lonely', { anchorText: 'Lonely guide' }),
      ],
      htmlByUrl: {
        [`${ORIGIN}/`]: homeHtml,
        [`${ORIGIN}/privacy`]: privacyHtml,
        [`${ORIGIN}/lonely`]: ORPHAN_HTML,
      },
    })
    expect(issues.filter((i) => i.kind === 'orphan-footer-only').map((i) => i.targetUrl)).toEqual([
      `${ORIGIN}/lonely`,
    ])
  })

  it('decodes stored title entities in footer-only hints', () => {
    const homeHtml = `<!doctype html><html><body>
<footer><a href="/lonely">Lonely</a></footer>
<main><p>Home</p></main>
</body></html>`
    const issues = detectLinkHealthIssues({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        {
          url: `${ORIGIN}/`,
          title: 'Home',
          h1: 'Home',
          html: homeHtml,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/lonely`,
          title: 'Vehicle History &amp; Support Team',
          h1: 'Vehicle History &amp; Support Team',
          html: ORPHAN_HTML,
          httpStatus: 200,
        },
      ],
      edges: [edge('/', '/lonely', { anchorText: 'Lonely' })],
      htmlByUrl: { [`${ORIGIN}/`]: homeHtml, [`${ORIGIN}/lonely`]: ORPHAN_HTML },
    })
    const orphan = issues.find((i) => i.kind === 'orphan-footer-only')
    expect(orphan?.hint).toContain('Vehicle History & Support Team')
    expect(orphan?.hint).not.toContain('&amp;')
    expect(orphan?.anchorText).toBe('Vehicle History & Support Team')
  })

  it('uses a content page, not a utility page, as the footer-only related-reading source', () => {
    const privacyHtml = `<!doctype html><html><body>
<footer><a href="/lonely">Lonely guide</a></footer>
<main><h1>Privacy Policy</h1></main>
</body></html>`
    const articleHtml = `<!doctype html><html><body>
<main><article><h1>MOT cost</h1><p>Fees.</p></article></main>
<footer><a href="/lonely">Lonely guide</a></footer>
</body></html>`
    const issues = detectLinkHealthIssues({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        {
          url: `${ORIGIN}/`,
          title: 'Home',
          h1: 'Home',
          html: `<html><body><main><h1>Home</h1></main></body></html>`,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/privacy`,
          title: 'Privacy Policy',
          h1: 'Privacy Policy',
          html: privacyHtml,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/blog/mot-cost-uk-2026.html`,
          title: 'MOT cost UK 2026',
          h1: 'MOT cost UK 2026',
          html: articleHtml,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/lonely`,
          title: 'Lonely guide',
          h1: 'Lonely guide',
          html: ORPHAN_HTML,
          httpStatus: 200,
        },
      ],
      edges: [
        edge('/privacy', '/lonely', { anchorText: 'Lonely guide' }),
        edge('/blog/mot-cost-uk-2026.html', '/lonely', { anchorText: 'Lonely guide' }),
      ],
      htmlByUrl: {
        [`${ORIGIN}/privacy`]: privacyHtml,
        [`${ORIGIN}/blog/mot-cost-uk-2026.html`]: articleHtml,
        [`${ORIGIN}/lonely`]: ORPHAN_HTML,
      },
    })
    const orphan = issues.find((i) => i.kind === 'orphan-footer-only')
    expect(orphan?.targetUrl).toBe(`${ORIGIN}/lonely`)
    expect(orphan?.sourceUrl).toBe(`${ORIGIN}/blog/mot-cost-uk-2026.html`)
    expect(orphan?.sourceUrl).not.toContain('/privacy')
  })

  it('does not flag ULEZ Checker as footer-only when a blog article links it in content', () => {
    const ulezUrl = `${ORIGIN}/ulez-checker-uk`
    const articleHtml = `<!doctype html><html><body>
<nav><a href="/ulez-checker-uk">ULEZ Checker</a></nav>
<div id="root">
  <h1>MOT changes 2026</h1>
  <p>Drivers should also use the <a href="/ulez-checker-uk">ULEZ Checker UK</a> before a test.</p>
</div>
<footer><a href="/ulez-checker-uk">ULEZ Checker</a></footer>
</body></html>`
    const homeHtml = `<!doctype html><html><body>
<nav><a href="/ulez-checker-uk">ULEZ Checker</a></nav>
<main><h1>Home</h1></main>
<footer><a href="/ulez-checker-uk">ULEZ Checker</a></footer>
</body></html>`
    const ulezHtml = `<!doctype html><html><body>
<nav><a href="/">Home</a></nav>
<h1>ULEZ Checker UK</h1>
<p>Check whether a vehicle is ULEZ compliant.</p>
<footer><a href="/ulez-checker-uk">ULEZ Checker</a></footer>
</body></html>`
    const issues = detectLinkHealthIssues({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        {
          url: `${ORIGIN}/`,
          title: 'Home',
          h1: 'Home',
          html: homeHtml,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/blog/mot-changes-2026-dvsa-updates.html`,
          title: 'MOT changes 2026',
          h1: 'MOT changes 2026',
          html: articleHtml,
          httpStatus: 200,
        },
        {
          url: ulezUrl,
          title: 'ULEZ Checker UK',
          h1: 'ULEZ Checker UK',
          html: ulezHtml,
          httpStatus: 200,
        },
      ],
      edges: [
        edge('/', '/ulez-checker-uk', { anchorText: 'ULEZ Checker' }),
        edge('/blog/mot-changes-2026-dvsa-updates.html', '/ulez-checker-uk', {
          anchorText: 'ULEZ Checker UK',
        }),
      ],
      htmlByUrl: {
        [`${ORIGIN}/`]: homeHtml,
        [`${ORIGIN}/blog/mot-changes-2026-dvsa-updates.html`]: articleHtml,
        [ulezUrl]: ulezHtml,
      },
    })
    expect(issues.filter((i) => i.kind === 'orphan-footer-only')).toEqual([])
  })

  it('treats an in-content inlink as current even when the crawl edge uses a .html target URL', () => {
    const articleHtml = `<!doctype html><html><body>
<main><article>
  <h1>MOT changes 2026</h1>
  <p>See the <a href="/ulez-checker-uk.html">ULEZ Checker UK</a>.</p>
</article></main>
<footer><a href="/ulez-checker-uk">ULEZ Checker</a></footer>
</body></html>`
    const homeHtml = `<!doctype html><html><body>
<footer><a href="/ulez-checker-uk">ULEZ Checker</a></footer>
<main><h1>Home</h1></main>
</body></html>`
    const issues = detectLinkHealthIssues({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        {
          url: `${ORIGIN}/`,
          title: 'Home',
          h1: 'Home',
          html: homeHtml,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/blog/mot-changes-2026-dvsa-updates.html`,
          title: 'MOT changes 2026',
          h1: 'MOT changes 2026',
          html: articleHtml,
          httpStatus: 200,
        },
        {
          url: `${ORIGIN}/ulez-checker-uk`,
          title: 'ULEZ Checker UK',
          h1: 'ULEZ Checker UK',
          html: `<html><body><h1>ULEZ Checker UK</h1></body></html>`,
          httpStatus: 200,
        },
      ],
      edges: [
        edge('/', '/ulez-checker-uk', { anchorText: 'ULEZ Checker' }),
        {
          sourceUrl: `${ORIGIN}/blog/mot-changes-2026-dvsa-updates.html`,
          targetUrl: `${ORIGIN}/ulez-checker-uk.html`,
          hrefRaw: '/ulez-checker-uk.html',
          anchorText: 'ULEZ Checker UK',
          isNofollow: false,
          targetHttpStatus: 200,
          targetFinalUrl: `${ORIGIN}/ulez-checker-uk`,
          isRedirect: false,
        },
      ],
      htmlByUrl: {
        [`${ORIGIN}/`]: homeHtml,
        [`${ORIGIN}/blog/mot-changes-2026-dvsa-updates.html`]: articleHtml,
      },
    })
    expect(issues.filter((i) => i.kind === 'orphan-footer-only')).toEqual([])
  })
})

describe('collectInContentInlinkKeys', () => {
  it('includes targets linked from article/main and ignores footer/nav-only inlinks', () => {
    const articleHtml = `<!doctype html><html><body>
<main><article>
  <h1>MOT changes 2026</h1>
  <h2>Related</h2>
  <ul><li><a href="/ulez-checker-uk">ULEZ Checker UK</a></li></ul>
</article></main>
<footer><a href="/lonely">Lonely guide</a></footer>
</body></html>`
    const keys = collectInContentInlinkKeys({
      originUrl: ORIGIN,
      edges: [
        edge('/blog/mot-changes-2026-dvsa-updates.html', '/ulez-checker-uk', {
          anchorText: 'ULEZ Checker UK',
        }),
        edge('/', '/lonely', { anchorText: 'Lonely guide' }),
      ],
      htmlByUrl: {
        [`${ORIGIN}/blog/mot-changes-2026-dvsa-updates.html`]: articleHtml,
        [`${ORIGIN}/`]: HOME_HTML,
      },
    })
    expect(keys.has(`${ORIGIN}/ulez-checker-uk`)).toBe(true)
    expect(keys.has('/ulez-checker-uk')).toBe(true)
    expect(keys.has(`${ORIGIN}/lonely`)).toBe(false)
    expect(keys.has('/lonely')).toBe(false)
  })

  it('counts in-content links that sit outside article/main landmarks', () => {
    const spaHtml = `<!doctype html><html><body>
<nav><a href="/ulez-checker-uk">ULEZ</a></nav>
<div id="root"><h1>MOT cost</h1><p><a href="/ulez-checker-uk">ULEZ Checker UK</a></p></div>
<footer><a href="/lonely">Lonely</a></footer>
</body></html>`
    const keys = collectInContentInlinkKeys({
      originUrl: ORIGIN,
      edges: [
        edge('/blog/mot-cost-uk-2026.html', '/ulez-checker-uk', {
          anchorText: 'ULEZ Checker UK',
        }),
        edge('/blog/mot-cost-uk-2026.html', '/lonely', { anchorText: 'Lonely' }),
      ],
      htmlByUrl: {
        [`${ORIGIN}/blog/mot-cost-uk-2026.html`]: spaHtml,
      },
    })
    expect(keys.has(`${ORIGIN}/ulez-checker-uk`)).toBe(true)
    expect(keys.has(`${ORIGIN}/lonely`)).toBe(false)
  })
})
