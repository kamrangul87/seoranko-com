import { describe, expect, it } from 'vitest'
import {
  buildReportOnlyCsp,
  harvestOriginsFromHtml,
  newOriginsNotInAllowlist,
} from './build-policy'

describe('CSP harvest + report-only builder', () => {
  it('harvests script/link/img/iframe origins from static HTML', () => {
    const html = `
      <script src="https://www.googletagmanager.com/gtm.js"></script>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <img src="https://cdn.example.com/a.png" />
      <iframe src="https://player.vimeo.com/video/1"></iframe>
    `
    const rows = harvestOriginsFromHtml(html, 'https://example.com/')
    const origins = rows.map((r) => r.origin)
    expect(origins).toContain('https://www.googletagmanager.com')
    expect(origins).toContain('https://fonts.googleapis.com')
    expect(origins).toContain('https://cdn.example.com')
    expect(origins).toContain('https://player.vimeo.com')
  })

  it('builds a report-only CSP including self and observed hosts', () => {
    const harvested = harvestOriginsFromHtml(
      `<script src="https://www.googletagmanager.com/gtm.js"></script>`,
      'https://example.com/',
    )
    const { headerValue, origins } = buildReportOnlyCsp('https://example.com', harvested)
    expect(headerValue).toMatch(/default-src 'self'/)
    expect(headerValue).toMatch(/script-src[^;]*www\.googletagmanager\.com/)
    expect(headerValue).toMatch(/connect-src[^;]*www\.googletagmanager\.com/)
    expect(origins).toContain('https://www.googletagmanager.com')
  })

  it('detects newly observed origins vs allowlist', () => {
    expect(
      newOriginsNotInAllowlist(
        ['https://example.com', 'https://new.cdn.com'],
        ['https://example.com'],
      ),
    ).toEqual(['https://new.cdn.com'])
  })
})
