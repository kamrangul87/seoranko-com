import { describe, expect, it } from 'vitest'
import {
  extractSitemapLocs,
  parseSitemapXml,
  ensureSitemapNamespace,
  stripChangefreqAndPriority,
  SITEMAP_NAMESPACE,
  isAbsoluteHttpLoc,
} from './sitemap-xml'
import { robotsInspectionFromBody } from './sitemap-inspect'

describe('sitemap-xml', () => {
  it('extracts locs and parses index children', () => {
    const xml = `<?xml version="1.0"?>
<urlset xmlns="${SITEMAP_NAMESPACE}">
  <url><loc>https://example.com/a</loc><changefreq>weekly</changefreq></url>
  <url><loc>https://example.com/b</loc></url>
</urlset>`
    expect(extractSitemapLocs(xml)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
    const p = parseSitemapXml(xml)
    expect(p.kind).toBe('urlset')
    expect(p.namespaceOk).toBe(true)
    expect(p.hasChangefreq).toBe(true)
  })

  it('parses sitemapindex', () => {
    const xml = `<?xml version="1.0"?>
<sitemapindex xmlns="${SITEMAP_NAMESPACE}">
  <sitemap><loc>https://example.com/s1.xml</loc></sitemap>
</sitemapindex>`
    const p = parseSitemapXml(xml)
    expect(p.kind).toBe('sitemapindex')
    expect(p.childSitemapLocs).toEqual(['https://example.com/s1.xml'])
  })

  it('fixes namespace and strips ignored fields', () => {
    const raw = `<urlset xmlns="http://wrong"><url><loc>/x</loc><priority>0.5</priority></url></urlset>`
    expect(ensureSitemapNamespace(raw)).toContain(SITEMAP_NAMESPACE)
    expect(stripChangefreqAndPriority(raw)).not.toMatch(/priority/i)
    expect(isAbsoluteHttpLoc('/x')).toBe(false)
  })
})

describe('robots Sitemap: records (S19)', () => {
  it('collects Sitemap: anywhere, including inside UA groups', () => {
    const body = `User-agent: *
Disallow: /admin
Sitemap: https://example.com/a.xml

User-agent: Googlebot
Disallow: /private
Sitemap: https://example.com/b.xml
`
    const insp = robotsInspectionFromBody(body)
    expect(insp.sitemapRecords).toHaveLength(2)
    expect(insp.sitemapRecords.map((r) => r.value)).toEqual([
      'https://example.com/a.xml',
      'https://example.com/b.xml',
    ])
  })
})
