import { describe, expect, it } from 'vitest'
import { addRelatedArticlesBlock, buildRelatedArticlesHtml } from './fix-add-related'

const AUTODUN_RELATED = `<nav class="related-articles" aria-label="Related articles" style="max-width:780px;margin:48px auto 0;padding:0 24px;">
  <h2 style="font-size:20px;margin-bottom:12px;">Related articles</h2>
  <ul style="padding-left:20px;line-height:1.9;">
    <li><a href="/blog/mot-advisories-explained-uk.html">MOT Advisories Explained: Dangerous, Major, Minor and What to Fix</a></li>
    <li><a href="/blog/ev-charging-reliability-uk.html">EV Charging Reliability UK: What the 99% Rule Covers</a></li>
  </ul>
</nav>`

describe('buildRelatedArticlesHtml', () => {
  it('writes up to 5 related reading links from provided title/H1 anchors', () => {
    const html = buildRelatedArticlesHtml([
      { href: '/a', anchorText: 'A guide to MOT costs' },
      { href: '/b', anchorText: 'B' },
      { href: '/c', anchorText: 'C' },
      { href: '/d', anchorText: 'D' },
      { href: '/e', anchorText: 'E' },
      { href: '/f', anchorText: 'F' },
    ])
    expect(html).toContain('data-seoranko-related-articles')
    expect(html).toContain('Related reading')
    expect(html.match(/<li>/g)?.length).toBe(5)
    expect(html).not.toContain('href="/f"')
  })

  it('HTML-escapes href and anchor values', () => {
    const html = buildRelatedArticlesHtml([
      {
        href: '/blog/foo"bar.html?a=1&b=2',
        anchorText: 'A & B <C>',
      },
    ])
    expect(html).toContain('href="/blog/foo&quot;bar.html?a=1&amp;b=2"')
    expect(html).toContain('A &amp; B &lt;C&gt;')
    expect(html).not.toContain('href="/blog/foo"bar')
    expect(html).not.toContain('A & B <C>')
  })
})

describe('addRelatedArticlesBlock', () => {
  it('appends into an existing related-articles nav instead of a second block', () => {
    const page = `<article><p>MOT history</p></article>${AUTODUN_RELATED}`
    const result = addRelatedArticlesBlock(page, [
      {
        href: '/blog/mot-changes-2026-dvsa-updates.html',
        anchorText: 'MOT Changes 2026:',
        h1: 'MOT Changes 2026: DVSA Updates, New Rules & What UK Drivers Need to Know',
        title: 'MOT Changes 2026 – DVSA Updates, New Rules & What UK Drivers Need to Know | Autodun',
      },
    ])
    expect(result.updated).toBe(1)
    expect(result.html).toContain('href="/blog/mot-changes-2026-dvsa-updates.html"')
    expect(result.html).not.toMatch(/MOT Changes 2026:<\/a>/)
    expect((result.html.match(/related-articles/g) || []).length).toBeGreaterThanOrEqual(1)
    expect(result.html).not.toMatch(
      /data-seoranko-related-articles[\s\S]*related-articles|related-articles[\s\S]*data-seoranko-related-articles/,
    )
    expect(result.html.match(/<nav /g)?.length).toBe(1)
    expect(result.html).toContain('class="related-articles"')
    expect(result.html).toContain('style="max-width:780px;margin:48px auto 0;padding:0 24px;"')
    expect(result.html).toContain('style="padding-left:20px;line-height:1.9;"')
  })

  it('skips hrefs already present in the existing list', () => {
    const page = `<article><p>body</p></article>${AUTODUN_RELATED}`
    const result = addRelatedArticlesBlock(page, [
      {
        href: '/blog/ev-charging-reliability-uk.html',
        anchorText: 'EV charging',
      },
      {
        href: '/blog/mot-cost-uk-2026.html',
        anchorText: 'MOT Cost in the UK 2026',
      },
    ])
    expect(result.updated).toBe(1)
    expect(
      result.html.match(/href="\/blog\/ev-charging-reliability-uk\.html"/g)?.length,
    ).toBe(1)
    expect(result.html).toContain('href="/blog/mot-cost-uk-2026.html"')
  })

  it('updates an existing SEORANKO block instead of no-op (idempotent)', () => {
    const first = addRelatedArticlesBlock('<article><p>body</p></article>', [
      { href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT Cost in the UK 2026' },
    ])
    expect(first.updated).toBe(1)
    expect(first.html).toContain('MOT Cost in the UK 2026')
    const again = addRelatedArticlesBlock(first.html, [
      { href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT Cost in the UK 2026' },
      { href: '/blog/mot-history-check-uk.html', anchorText: 'MOT History Check UK' },
    ])
    expect(again.updated).toBe(1)
    expect(again.html).toContain('MOT History Check UK')
    expect(again.html.match(/data-seoranko-related-articles/g)?.length).toBe(1)
    const third = addRelatedArticlesBlock(again.html, [
      { href: '/blog/mot-history-check-uk.html', anchorText: 'MOT History Check UK' },
    ])
    expect(third.updated).toBe(0)
  })

  it('places a new block before </article> with article-like inline styles', () => {
    const page =
      '<article style="max-width:720px;margin:0 auto;padding:0 20px;"><p>body</p></article>'
    const result = addRelatedArticlesBlock(page, [
      { href: '/blog/a.html', anchorText: 'A complete guide to MOT tests' },
    ])
    expect(result.html).toMatch(/<(aside|nav)[^>]*>[\s\S]*<\/article>/i)
    expect(result.html).not.toMatch(/<\/article>\s*<(aside|nav)/i)
    expect(result.html).toMatch(/max-width:\s*720px/)
    expect(result.html).toMatch(/margin:\s*0 auto|margin:[^"]*auto/)
  })

  it('appends into an h2 Related heading plus ul (mot-cost shaped page)', () => {
    const page = `<!doctype html><html><body>
<div class="wrap">
  <h1>MOT Cost UK 2026</h1>
  <p>Fees.</p>
  <h2>Related</h2>
  <ul>
    <li><a href="/blog/motorbike-mot-cost-uk-2026.html">Motorbike MOT Costs — What to expect in 2026</a></li>
    <li><a href="/blog/mot-retest-cost-uk-2026.html">MOT retest costs</a></li>
  </ul>
</div>
<footer>Site footer</footer>
</body></html>`
    const result = addRelatedArticlesBlock(page, [
      {
        href: '/blog/mot-changes-2026-dvsa-updates.html',
        anchorText: 'MOT Changes 2026:',
        h1: 'MOT Changes 2026: DVSA Updates, New Rules & What UK Drivers Need to Know',
      },
    ])
    expect(result.updated).toBe(1)
    expect(result.html).toContain('href="/blog/mot-changes-2026-dvsa-updates.html"')
    expect(result.html).toMatch(
      /<h2>Related<\/h2>\s*<ul>[\s\S]*mot-changes-2026-dvsa-updates\.html/,
    )
    expect(result.html).not.toContain('data-seoranko-related-articles')
    expect(result.html).not.toMatch(/<\/footer>[\s\S]*<(aside|nav)/i)
    expect(result.html).not.toMatch(/<(aside|nav)[^>]*>\s*<h2>Related reading[\s\S]*<\/body>/i)
    expect(result.html).toMatch(/\n  <\/ul>/)
    expect(result.html).not.toMatch(/<\/li>\n<\/ul>/)
  })

  it('preserves the closing list tag indentation when appending into Autodun-shaped related nav', () => {
    const page = `<article><p>MOT history</p></article>${AUTODUN_RELATED}`
    const result = addRelatedArticlesBlock(page, [
      {
        href: '/blog/mot-changes-2026-dvsa-updates.html',
        anchorText: 'MOT Changes 2026 DVSA Updates',
      },
    ])
    expect(result.html).toContain('href="/blog/mot-changes-2026-dvsa-updates.html"')
    expect(result.html).toMatch(/\n  <\/ul>/)
    expect(result.html).not.toMatch(/<\/li>\n<\/ul>/)
  })

  it('does not append utility-page hrefs into a related list', () => {
    const page = `<article><p>body</p></article>${AUTODUN_RELATED}`
    const result = addRelatedArticlesBlock(page, [
      { href: '/privacy', anchorText: 'Privacy Policy' },
      { href: '/about', anchorText: 'About Autodun' },
      { href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT Cost in the UK 2026' },
    ])
    expect(result.html).not.toContain('href="/privacy"')
    expect(result.html).not.toContain('href="/about"')
    expect(result.html).toContain('href="/blog/mot-cost-uk-2026.html"')
  })

  it('appends into a Related heading plus list inside a related-articles div', () => {
    const page = `<body>
    <div class="related-articles">
      <h3>Related articles</h3>
      <ul>
        <li><a href="/blog/mot-cost-uk-2026.html">MOT Cost UK 2026</a></li>
      </ul>
    </div>
    <footer style="margin-top:80px;">Footer</footer>
    </body>`
    const result = addRelatedArticlesBlock(page, [
      { href: '/blog/electric-car-mot-whats-checked-uk-2026.html', anchorText: 'EV MOT UK 2026' },
    ])
    expect(result.html).toContain('href="/blog/electric-car-mot-whats-checked-uk-2026.html"')
    expect(result.html).toMatch(/<h3>Related articles<\/h3>[\s\S]*electric-car-mot-whats-checked-uk-2026\.html/)
    expect(result.html.match(/<h3>/g)?.length).toBe(1)
    expect(result.html).not.toMatch(/<\/footer>[\s\S]*aside/i)
  })

  it('appends matching <a> markup when Related heading is followed by anchors, not a list', () => {
    const page = `<body>
    <div class="related-articles">
      <h3>Related</h3>
      <a href="/blog/mot-cost-uk-2026.html">MOT Cost UK 2026 — What you’ll actually pay</a>
      <a href="/blog/mot-history-check-uk.html">MOT History Check — Read your car’s MOT record</a>
    </div>
    <footer>Footer</footer>
    </body>`
    const result = addRelatedArticlesBlock(page, [
      { href: '/blog/mot-changes-2026-dvsa-updates.html', anchorText: 'MOT Changes 2026' },
    ])
    expect(result.html).toContain('href="/blog/mot-changes-2026-dvsa-updates.html"')
    expect(result.html).toMatch(
      /<h3>Related<\/h3>[\s\S]*<a href="\/blog\/mot-changes-2026-dvsa-updates\.html">/,
    )
    expect(result.html).not.toContain('<aside')
    expect(result.html).not.toMatch(/<\/footer>[\s\S]*<(aside|nav|a )/i)
  })

  it('never inserts a new block after footer or directly before </body>', () => {
    const page = `<body><div class="content"><p>No related section.</p></div>
<footer>Site footer</footer>
</body>`
    const result = addRelatedArticlesBlock(page, [
      { href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT Cost in the UK 2026' },
    ])
    expect(result.updated).toBe(1)
    expect(result.html).toMatch(/<(aside|nav)[\s\S]*<\/aside>|<(aside|nav)[\s\S]*<\/nav>/i)
    expect(result.html).toMatch(/<(aside|nav)[\s\S]*<footer/i)
    expect(result.html).not.toMatch(/<\/footer>[\s\S]*<(aside|nav)/i)
    expect(result.html).not.toMatch(/<(aside|nav)[^>]*>[\s\S]*<\/\1>\s*<\/body>/i)
  })
})
