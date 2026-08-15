import { describe, it, expect } from 'vitest'
import { injectImagesIntoArticle, type ArticleImageSet, type GeneratedImage } from './image-generator'

function img(overrides: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: 'hero',
    url: 'https://example.supabase.co/storage/v1/object/public/article-images/hero.webp',
    width: 1200,
    height: 630,
    alt: 'hero alt',
    caption: 'hero caption',
    placement: 'Hero image (top of article)',
    prompt: 'a hero prompt',
    ...overrides,
  }
}

function imageSet(overrides: Partial<ArticleImageSet> = {}): ArticleImageSet {
  return {
    hero: img(),
    content: [],
    niche: 'other',
    styleDescriptor: 'test style',
    imageStats: { requested: 1, generated: 1, failures: [] },
    ...overrides,
  }
}

describe('injectImagesIntoArticle', () => {
  it('is pure — never mutates the input html string or imageSet object', () => {
    const html = '<h1>Title</h1><p>Intro</p><h2>Section</h2><p>Body</p>'
    const set = imageSet()
    const setSnapshot = JSON.stringify(set)
    const result = injectImagesIntoArticle(html, set)
    expect(html).toBe('<h1>Title</h1><p>Intro</p><h2>Section</h2><p>Body</p>') // original untouched
    expect(JSON.stringify(set)).toBe(setSnapshot) // imageSet untouched
    expect(result).not.toBe(html)
    expect(result).toContain('<figure')
  })

  it('inserts a hero figure before the H1', () => {
    const html = '<h1>Title</h1><p>Intro</p>'
    const result = injectImagesIntoArticle(html, imageSet())
    const figureIdx = result.indexOf('<figure')
    const h1Idx = result.indexOf('<h1')
    expect(figureIdx).toBeGreaterThanOrEqual(0)
    expect(figureIdx).toBeLessThan(h1Idx)
  })

  it('distributes content images across H2 sections after the first paragraph, skipping FAQ', () => {
    const html =
      '<h1>Title</h1>' +
      '<h2>Section One</h2><p>First para one.</p><p>Second para one.</p>' +
      '<h2>Section Two</h2><p>First para two.</p>' +
      '<h2>Frequently Asked Questions</h2><p>Disclaimer.</p><h3>Q?</h3><p>A.</p>'
    const set = imageSet({
      content: [
        img({ id: 'content-1', url: 'https://example.com/c1.webp', alt: 'c1' }),
        img({ id: 'content-2', url: 'https://example.com/c2.webp', alt: 'c2' }),
      ],
    })
    const result = injectImagesIntoArticle(html, set)
    // No image landed inside the FAQ section
    const faqIdx = result.indexOf('Frequently Asked Questions')
    expect(result.slice(faqIdx)).not.toContain('article-content-image')
    // Two content figures were placed
    expect((result.match(/article-content-image/g) || []).length).toBe(2)
  })

  it('produces zero figures when hero.url is empty (failed generation)', () => {
    const html = '<h1>Title</h1><p>Intro</p>'
    const set = imageSet({ hero: img({ url: '' }) })
    const result = injectImagesIntoArticle(html, set)
    expect(result).not.toContain('<figure')
  })

  it('returns empty string unchanged', () => {
    expect(injectImagesIntoArticle('', imageSet())).toBe('')
  })
})
