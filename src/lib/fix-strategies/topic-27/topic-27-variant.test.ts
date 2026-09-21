import { describe, expect, it } from 'vitest'
import {
  classifySitemapDuplicateVariant,
  pathDuplicateForms,
} from '@/lib/fix-strategies/topic-27'

describe('topic 27 sitemap duplicate-variant guard', () => {
  it('treats /blog/index.html as index-html variant of /blog', () => {
    const locs = new Set(['https://autodun.com/blog'])
    expect(
      classifySitemapDuplicateVariant(
        'https://autodun.com/blog/index.html',
        locs,
      ),
    ).toBe('index-html')
  })

  it('treats slash-only as slash-or-case', () => {
    const locs = new Set(['https://example.com/page'])
    expect(
      classifySitemapDuplicateVariant('https://example.com/page/', locs),
    ).toBe('slash-or-case')
  })

  it('pathDuplicateForms expands index.html both ways', () => {
    expect(pathDuplicateForms('/blog/index.html')).toEqual(
      expect.arrayContaining(['/blog', '/blog/', '/blog/index.html']),
    )
    expect(pathDuplicateForms('/blog')).toEqual(
      expect.arrayContaining(['/blog', '/blog/', '/blog/index.html']),
    )
  })
})
