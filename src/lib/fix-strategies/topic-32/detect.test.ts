import { describe, expect, it } from 'vitest'
import { detectClientRenderedThinOrMissingHeadings } from './detect'

function html(body: string, head: string = ''): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
}

describe('topic 32 — client-rendered shell thin/missing content', () => {
  it('flags a classic Next.js shell with no title and no h1', () => {
    const h = html(
      '<div id="__next"></div><script type="module" src="/_next/static/chunk.js"></script>',
      '',
    )
    const r = detectClientRenderedThinOrMissingHeadings({
      html: h,
      pageUrl: 'https://example.com/',
    })
    expect(r.findings.some((f) => f.verdict === 'finding-client-rendered-thin-or-missing-headings')).toBe(
      true,
    )
    const f = r.findings[0]!
    expect(f.severity).toBe('high')
    expect(f.detail).toMatch(/Google may see an almost empty page/i)
  })

  it('does not flag when title, h1 and sufficient body text are present', () => {
    const h = html(
      '<h1>Welcome</h1><p>This page is server-rendered with plenty of visible text content.</p>',
      '<title>Home</title>',
    )
    const r = detectClientRenderedThinOrMissingHeadings({
      html: h,
      pageUrl: 'https://example.com/',
    })
    expect(r.findings).toHaveLength(0)
    expect(r.suppressed.some((s) => s.verdict === 'ok')).toBe(true)
  })

  it('does not flag a thin non-shell HTML page (no framework root)', () => {
    const h = html('<p>Hi</p>', '<title>T</title>')
    const r = detectClientRenderedThinOrMissingHeadings({
      html: h,
      pageUrl: 'https://example.com/thin',
    })
    expect(r.findings).toHaveLength(0)
  })
})

