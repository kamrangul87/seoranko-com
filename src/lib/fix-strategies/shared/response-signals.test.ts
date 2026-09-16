import { describe, expect, it } from 'vitest'
import { extractHtmlCanonical, hasNoindexDirective } from './response-signals'

describe('hasNoindexDirective', () => {
  it('detects x-robots-tag noindex', () => {
    const headers = new Headers({ 'x-robots-tag': 'noindex, nofollow' })
    expect(hasNoindexDirective(headers, '', 'text/html')).toBe(true)
  })

  it('detects meta robots noindex in HTML', () => {
    const body =
      '<!doctype html><html><head><meta name="robots" content="noindex"></head><body></body></html>'
    expect(hasNoindexDirective(new Headers(), body, 'text/html')).toBe(true)
  })

  it('R7: expands none to noindex case-insensitively', () => {
    const body =
      '<!doctype html><html><head><meta name="Robots" content="None"></head><body></body></html>'
    expect(hasNoindexDirective(new Headers(), body, 'text/html')).toBe(true)
  })

  it('returns false when neither header nor meta carries noindex', () => {
    const body =
      '<!doctype html><html><head><title>Ok</title></head><body></body></html>'
    expect(hasNoindexDirective(new Headers(), body, 'text/html')).toBe(false)
  })

  it('R8: detects robots noindex in <body> (unlike canonical C2)', () => {
    const body =
      '<!doctype html><html><head><title>Ok</title></head><body><meta name="robots" content="noindex"><p>x</p></body></html>'
    expect(hasNoindexDirective(new Headers(), body, 'text/html')).toBe(true)
  })

  it('R8 vs C2: body robots counts; body canonical does not count as HTML canonical', () => {
    const html = `<!doctype html><html><head><title>t</title>
      <div>closes</div>
      <link rel="canonical" href="https://example.com/page">
      <meta name="robots" content="noindex">
    </head><body></body></html>`
    // After premature close, both link and meta are in body.
    expect(
      extractHtmlCanonical(html, 'https://example.com/page', 'text/html'),
    ).toBeNull()
    expect(hasNoindexDirective(new Headers(), html, 'text/html')).toBe(true)
  })
})
