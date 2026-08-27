import { describe, it, expect } from 'vitest'
import { stripStrayDocumentWrapperTags, assertNoDocumentWrapperTags } from './html-document-guard'

// Reproduces the exact real-article defect (article ba103270, 2026-08-20):
// a model-written <!DOCTYPE html><html><head>...</head> wrapper with no
// closing <body> at all, immediately followed by the real article body.
const REAL_DEFECT_SHAPE = `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">

<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EV Charger Guide</title>
</head>

<figure class="article-hero-image"><img src="https://example.com/hero.webp"></figure>
<h1>EV Charger Guide</h1>
<p>Some real article content.</p>
</html>`

describe('stripStrayDocumentWrapperTags', () => {
  it('strips the exact real-article defect shape, leaving only body content', () => {
    const result = stripStrayDocumentWrapperTags(REAL_DEFECT_SHAPE)
    expect(result.stripped).toBe(true)
    expect(result.strippedTags).toEqual(expect.arrayContaining(['head', 'doctype', 'html']))
    expect(result.html).not.toMatch(/<!DOCTYPE/i)
    expect(result.html).not.toMatch(/<\/?html\b/i)
    expect(result.html).not.toMatch(/<\/?head\b/i)
    expect(result.html).not.toMatch(/<title>/i)
    expect(result.html).toContain('<h1>EV Charger Guide</h1>')
    expect(result.html).toContain('<p>Some real article content.</p>')
    expect(result.html).toContain('<figure class="article-hero-image">')
  })

  it('strips a <body> tag too when present', () => {
    const html = '<html><head><title>x</title></head><body><h1>Real</h1></body></html>'
    const result = stripStrayDocumentWrapperTags(html)
    expect(result.strippedTags).toContain('body')
    expect(result.html).not.toMatch(/<\/?body\b/i)
    expect(result.html).toContain('<h1>Real</h1>')
  })

  it('is a no-op on a clean body-only fragment', () => {
    const html = '<h1>Title</h1>\n<p>Clean content.</p>'
    const result = stripStrayDocumentWrapperTags(html)
    expect(result.stripped).toBe(false)
    expect(result.html).toBe(html)
  })

  it('handles empty input', () => {
    expect(stripStrayDocumentWrapperTags('')).toEqual({ html: '', stripped: false, strippedTags: [] })
  })
})

describe('assertNoDocumentWrapperTags', () => {
  it('flags the real-article defect shape', () => {
    const error = assertNoDocumentWrapperTags(REAL_DEFECT_SHAPE)
    expect(error).toBeTruthy()
    expect(error).toContain('<!DOCTYPE html>')
    expect(error).toContain('<html>')
    expect(error).toContain('<head>')
  })

  it('passes a clean fragment', () => {
    expect(assertNoDocumentWrapperTags('<h1>Title</h1>\n<p>Clean.</p>')).toBeUndefined()
  })

  it('passes after stripping', () => {
    const stripped = stripStrayDocumentWrapperTags(REAL_DEFECT_SHAPE).html
    expect(assertNoDocumentWrapperTags(stripped)).toBeUndefined()
  })
})
