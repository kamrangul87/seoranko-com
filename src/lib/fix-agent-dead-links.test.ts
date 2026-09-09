import { describe, expect, it } from 'vitest'
import { removeDeadLinkFromHtml, removeDeadLinkFromSource } from './fix-agent-dead-links'

describe('removeDeadLinkFromHtml', () => {
  it('removes absolute and relative anchors to a 404 destination', () => {
    const html =
      '<footer><a href="/privacy">Privacy</a><a href="https://example.com/privacy">P2</a><a href="/ok">OK</a></footer>'
    const r = removeDeadLinkFromHtml(html, 'https://example.com/privacy')
    expect(r.changed).toBe(true)
    expect(r.removed).toBeGreaterThanOrEqual(2)
    expect(r.html).not.toMatch(/privacy/i)
    expect(r.html).toContain('href="/ok"')
  })
})

describe('removeDeadLinkFromSource (React SPA)', () => {
  it('removes Link to="/privacy" and path array entries without inventing content', () => {
    const src = `
const policyLinks = [
  { path: "/privacy", label: "Privacy Policy" },
  { path: "/terms", label: "Terms of Use" },
];
return (
  <>
    <Link to="/privacy">Privacy</Link>
    <Link to="/terms">Terms</Link>
    <a href="/privacy">Also</a>
  </>
);
`
    const r = removeDeadLinkFromSource(src, 'https://autodun.com/privacy')
    expect(r.changed).toBe(true)
    expect(r.removed).toBeGreaterThanOrEqual(2)
    expect(r.content).not.toMatch(/\/privacy/)
    expect(r.content).toMatch(/\/terms/)
    expect(r.content).not.toMatch(/Privacy Policy/)
  })
})
