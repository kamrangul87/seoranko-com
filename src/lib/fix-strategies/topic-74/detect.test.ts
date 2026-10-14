import { describe, expect, it } from 'vitest'
import {
  classifyOriginPrefixedHref,
  detectOriginPrefixedExternalHrefs,
} from './detect'

describe('topic 74 origin-prefixed external href', () => {
  it('detects autodun-style absolute URL nested under site origin', () => {
    const html = `
      <a href="/blog">ok</a>
      <a href="https://autodun.com/https://www.gov.uk/check-mot-history">bad</a>
      <a href="https://www.gov.uk/getting-an-mot">ok external</a>
    `
    const r = detectOriginPrefixedExternalHrefs(
      html,
      'https://autodun.com/blog/mot-history-check-uk.html',
    )
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]!.verdict).toBe('origin-prefixed-external-href')
    expect(r.findings[0]!.embeddedExternal).toBe(
      'https://www.gov.uk/check-mot-history',
    )
    expect(r.findings[0]!.detail).toMatch(/prefixed with this site's own domain/i)
  })

  it('detects /https://… relative form and scheme-less www. host path', () => {
    expect(
      classifyOriginPrefixedHref(
        '/https://www.gov.uk/foo',
        'https://autodun.com/blog/x.html',
      )?.embeddedExternal,
    ).toBe('https://www.gov.uk/foo')

    expect(
      classifyOriginPrefixedHref(
        'https://autodun.com/www.gov.uk/check-mot-history',
        'https://autodun.com/blog/x.html',
      )?.embeddedExternal,
    ).toMatch(/www\.gov\.uk\/check-mot-history/)
  })

  it('does not flag a normal absolute external or normal internal link', () => {
    const html = `
      <a href="https://www.gov.uk/getting-an-mot">gov</a>
      <a href="/blog/mot-cost-uk-2026.html">internal</a>
    `
    const r = detectOriginPrefixedExternalHrefs(
      html,
      'https://autodun.com/blog/x.html',
    )
    expect(r.findings).toHaveLength(0)
  })
})
