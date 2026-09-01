import { describe, expect, it } from 'vitest'
import {
  buildHtaccessRedirectSnippet,
  buildNextJsRedirectSnippet,
  buildNginxRedirectSnippet,
  developerRedirectSnippets,
} from './developer-snippet-placements'

describe('developer-snippet-placements', () => {
  const from = 'https://autodun.com/charging-map'
  const to = 'https://autodun.com/'
  const evidence = 'HTTP 404 at https://autodun.com/charging-map'

  it('Next.js snippet is a complete valid next.config.js with redirects()', () => {
    const s = buildNextJsRedirectSnippet(from, to, evidence)
    expect(s.placementBefore).toMatch(/next\.config\.js/i)
    expect(s.placementBefore).toMatch(/package\.json/)
    expect(s.placementBefore).toMatch(/redirects\(\)/)
    expect(s.content).toMatch(/async redirects\(\)/)
    expect(s.content).toMatch(/module\.exports = nextConfig/)
    expect(s.content).toContain("source: '/charging-map'")
    expect(s.content).toContain("destination: '/'")
    expect(s.placementAfter).toMatch(/Run Fix Agent/)
    expect(s.placementAfter).toMatch(/committed/)
  })

  it('htaccess snippet explains Apache-only and root placement', () => {
    const s = buildHtaccessRedirectSnippet(from, to, evidence)
    expect(s.placementBefore).toMatch(/\.htaccess/i)
    expect(s.placementBefore).toMatch(/Apache/i)
    expect(s.placementBefore).toMatch(/shared hosting/i)
    expect(s.content).toMatch(/RewriteRule/)
  })

  it('nginx snippet warns most beginners cannot edit server config', () => {
    const s = buildNginxRedirectSnippet(from, to, evidence)
    expect(s.placementBefore).toMatch(/nginx/i)
    expect(s.placementBefore).toMatch(/developer|DevOps|hosting support/i)
    expect(s.placementBefore).toMatch(/cannot edit nginx directly|cannot edit nginx/i)
  })

  it('developerRedirectSnippets returns all three with placement notes', () => {
    const all = developerRedirectSnippets(from, to, evidence)
    expect(all).toHaveLength(3)
    for (const s of all) {
      expect(s.placementBefore).toBeTruthy()
      expect(s.content.length).toBeGreaterThan(10)
    }
  })
})
