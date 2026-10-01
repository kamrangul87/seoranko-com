import { describe, expect, it } from 'vitest'
import {
  looksClientOnly,
  looksLikeNonHtmlDocument,
} from './fetch-page'

const WP_SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="https://example.com/wp-sitemap.xsl" ?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/hello-world/</loc></url></urlset>`

describe('looksClientOnly — non-HTML / XML guard', () => {
  it('does not treat WordPress sitemap XML as a JS shell (word-count trap)', () => {
    // Tag-stripped body has ~1–3 tokens — the old heuristic returned true.
    expect(looksLikeNonHtmlDocument(WP_SITEMAP_XML, 'application/xml')).toBe(
      true,
    )
    expect(looksClientOnly(WP_SITEMAP_XML, 'application/xml')).toBe(false)
    // Even when Content-Type is wrong/missing, XML prologue wins.
    expect(looksClientOnly(WP_SITEMAP_XML, null)).toBe(false)
    expect(looksClientOnly(WP_SITEMAP_XML, 'text/html')).toBe(false)
  })

  it('still flags a real JS shell with bundle + zero anchors', () => {
    const shell =
      '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>'
    expect(looksClientOnly(shell, 'text/html')).toBe(true)
  })

  it('does not flag rich HTML with anchors', () => {
    // ≥20 visible words after tag strip — below that the shell heuristic fires.
    const html = `<!doctype html><html><body>
<p>One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone.</p>
<a href="/about">About</a>
</body></html>`
    expect(looksClientOnly(html, 'text/html')).toBe(false)
  })
})
