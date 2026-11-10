import { describe, expect, it } from 'vitest'
import { addRelatedArticlesBlock, buildRelatedArticlesHtml } from './fix-add-related'

describe('buildRelatedArticlesHtml', () => {
  it('writes up to 5 related reading links from provided title/H1 anchors', () => {
    const html = buildRelatedArticlesHtml([
      { href: '/a', anchorText: 'A' },
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
})

describe('addRelatedArticlesBlock', () => {
  it('inserts the block before </article> and is a no-op when already present', () => {
    const first = addRelatedArticlesBlock(
      '<article><p>body</p></article>',
      [{ href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT Cost in the UK 2026' }],
    )
    expect(first.updated).toBe(1)
    expect(first.html).toContain('MOT Cost in the UK 2026')
    const again = addRelatedArticlesBlock(first.html, [
      { href: '/x', anchorText: 'X' },
    ])
    expect(again.updated).toBe(0)
  })
})
