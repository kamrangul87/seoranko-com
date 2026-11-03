import { describe, expect, it } from 'vitest'
import { detectArticleSchemaMissing } from './detect'

function page(body: string, head = '<title>Post</title>'): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
}

describe('topic 40 — article JSON-LD missing', () => {
  it('proposes Article JSON-LD when page looks like an article and no JSON-LD exists', () => {
    const h = page(
      '<article><h1>Great news</h1><time datetime="2024-10-01">1 Oct 2024</time><p>Body.</p></article>',
      '<title>Great news</title><meta name="author" content="Jane Doe" />',
    )
    const r = detectArticleSchemaMissing({ html: h, pageUrl: 'https://example.com/post' })
    expect(r.findings.some((f) => f.verdict === 'auto-add-article-json-ld')).toBe(true)
    const f = r.findings[0]!
    expect((f.proposed.jsonLd as any).headline).toBe('Great news')
    expect((f.proposed.jsonLd as any).author?.name).toBe('Jane Doe')
    expect((f.proposed.jsonLd as any)['@type']).toBe('Article')
  })

  it('suppresses when JSON-LD already present', () => {
    const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Great news"}</script>`
    const h = page(
      `<article><h1>Great news</h1><p>Body.</p></article>${ld}`,
      '<title>Great news</title>',
    )
    const r = detectArticleSchemaMissing({ html: h, pageUrl: 'https://example.com/post' })
    expect(r.findings).toHaveLength(0)
    expect(r.suppressed.some((s) => s.verdict === 'ok')).toBe(true)
  })

  it('suppresses on non-article pages (e.g., index listing)', () => {
    const h = page('<h1>Blog</h1><p>Index.</p>')
    const r = detectArticleSchemaMissing({ html: h, pageUrl: 'https://example.com/blog/' })
    expect(r.findings).toHaveLength(0)
  })
})

