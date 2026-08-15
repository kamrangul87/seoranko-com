import { describe, it, expect } from 'vitest'
import {
  extractMetaComment,
  extractArticleDescription,
  stripSeoDescriptionTags,
  dedupeMetaDescriptionTags,
} from './extract-meta-description'

describe('extractMetaComment', () => {
  it('allows hyphens inside META (off-peak, UK-based)', () => {
    const html = '<!-- META: Discover why UK EV charger selection should prioritize off-peak electricity compatibility over raw speed. -->'
    expect(extractMetaComment(html)).toMatch(/off-peak electricity/)
  })

  it('old hyphen-stopping regex would fail — we must not', () => {
    const html = '<!-- META: Cost-effective home charging for UK drivers. -->'
    expect(extractMetaComment(html)).toBe('Cost-effective home charging for UK drivers.')
  })
})

describe('extractArticleDescription', () => {
  it('prefers META comment over generic fallback', () => {
    const html = `<!-- META: Discover why UK EV charger selection should prioritize off-peak rates. -->
<h1>EV Charger Guide</h1><p>Body text here about charging at home overnight.</p>`
    expect(extractArticleDescription(html, 'ev charger')).toMatch(/off-peak/)
    expect(extractArticleDescription(html, 'ev charger')).not.toMatch(/^Article about/i)
  })

  it('uses existing meta name=description when META comment missing', () => {
    const html = `<meta name="description" content="Well written description about UK home EV charging costs." />
<h1>Guide</h1>`
    expect(extractArticleDescription(html, 'ev charger')).toMatch(/Well written/)
  })

  it('ignores generic Article about fallback tags', () => {
    const html = `<meta name="description" content="Article about ev charger" />
<p>A 7.4 kW home wallbox can recharge a typical EV overnight on an off-peak tariff.</p>`
    const desc = extractArticleDescription(html, 'ev charger')
    expect(desc).not.toMatch(/^Article about/i)
    expect(desc.length).toBeGreaterThan(40)
  })
})

describe('dedupeMetaDescriptionTags', () => {
  it('keeps the good description and drops the generic duplicate', () => {
    const html = `<meta name="description" content="Discover why UK EV charger selection should prioritize off-peak electricity." />
<script type="application/ld+json">{}</script>
<meta name="description" content="Article about ev charger" />`
    const out = dedupeMetaDescriptionTags(html)
    const tags = out.match(/<meta\s+name=["']description["'][^>]*>/gi) || []
    expect(tags).toHaveLength(1)
    expect(tags[0]).toMatch(/off-peak/)
    expect(out).not.toMatch(/Article about ev charger/)
  })
})

describe('stripSeoDescriptionTags', () => {
  it('removes name and social description tags', () => {
    const html = `<meta name="description" content="a" />
<meta property="og:description" content="b" />
<meta name="twitter:description" content="c" />
<p>keep</p>`
    const out = stripSeoDescriptionTags(html)
    expect(out).not.toMatch(/description/)
    expect(out).toMatch(/keep/)
  })
})
