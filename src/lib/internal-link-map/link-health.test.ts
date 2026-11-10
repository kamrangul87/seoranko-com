import { describe, expect, it } from 'vitest'
import { detectLinkHealthIssues } from './link-health'
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
})
