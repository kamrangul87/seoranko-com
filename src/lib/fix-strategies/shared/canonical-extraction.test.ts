import { describe, expect, it } from 'vitest'
import {
  extractCanonicalDeclarations,
  extractLinkHeaderCanonicals,
  distinctNormalizedTargets,
} from './canonical-extraction'

const PAGE = 'https://example.com/page'

describe('extractCanonicalDeclarations (shared)', () => {
  it('reads head canonical as the parser sees it', () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://example.com/page">
    </head><body><p>hi</p></body></html>`
    const ex = extractCanonicalDeclarations(html, new Headers(), PAGE, 'text/html')
    expect(ex.head).toHaveLength(1)
    expect(ex.head[0]!.normalized).toBe('https://example.com/page')
    expect(ex.headAbsent).toBe(false)
    expect(ex.effectiveHead?.normalized).toBe('https://example.com/page')
  })

  it('CRITICAL: body-content before </head> puts following canonical in body (C2)', () => {
    const html = `<!doctype html><html><head>
      <title>x</title>
      <div id="premature">closes head</div>
      <link rel="canonical" href="https://example.com/page">
    </head><body><p>hi</p></body></html>`
    const ex = extractCanonicalDeclarations(html, new Headers(), PAGE, 'text/html')
    expect(ex.head).toHaveLength(0)
    expect(ex.body).toHaveLength(1)
    expect(ex.headAbsent).toBe(true)
    expect(ex.hasBodyMisplaced).toBe(true)
    expect(ex.effectiveHead).toBeNull()
  })

  it('parses HTTP Link header rel=canonical', () => {
    const headers = new Headers({
      link: '<https://example.com/canon>; rel="canonical"',
    })
    const ex = extractCanonicalDeclarations('', headers, PAGE, 'text/html')
    expect(ex.header).toHaveLength(1)
    expect(ex.header[0]!.normalized).toBe('https://example.com/canon')
  })

  it('does not collapse trailing slash / query in normalisation', () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://example.com/Page/?q=1">
    </head><body></body></html>`
    const ex = extractCanonicalDeclarations(html, new Headers(), PAGE, 'text/html')
    expect(ex.head[0]!.normalized).toBe('https://example.com/Page/?q=1')
  })

  it('effectiveHead is null when multiple head declarations exist', () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://example.com/a">
      <link rel="canonical" href="https://example.com/b">
    </head><body></body></html>`
    const ex = extractCanonicalDeclarations(html, new Headers(), PAGE, 'text/html')
    expect(ex.head).toHaveLength(2)
    expect(ex.effectiveHead).toBeNull()
    expect(distinctNormalizedTargets(ex.head)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })

  it('extractLinkHeaderCanonicals handles multi-entry Link headers', () => {
    const headers = new Headers({
      link: '</style.css>; rel="stylesheet", <https://example.com/c>; rel="canonical"',
    })
    const decls = extractLinkHeaderCanonicals(headers, PAGE)
    expect(decls).toHaveLength(1)
    expect(decls[0]!.normalized).toBe('https://example.com/c')
  })
})
