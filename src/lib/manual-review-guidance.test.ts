import { describe, it, expect } from 'vitest'
import { buildActionHint, withActionHints } from './quality-issue-action-hints'
import { panelScoresFromMeta, computePanelScores } from './panel-scores'

describe('quality-issue-action-hints', () => {
  it('M07: points to Brand Settings, not the JSON-LD block', () => {
    const hint = buildActionHint({
      id: 'schema-Organization-logo',
      category: 'schema',
      title: 'Organization: logo',
      description: 'Organization is missing a logo.',
      autoFixable: false,
    })
    expect(hint.toLowerCase()).toContain('brand settings')
    expect(hint.toLowerCase()).not.toContain('json-ld')
  })

  it('M07 (non-blocking prompt id): also points to Brand Settings', () => {
    const hint = buildActionHint({
      id: 'schema-logo-not-configured',
      category: 'schema',
      title: 'Organization logo not configured — publisher.logo omitted',
      description: 'No brand_settings.logo_url configured.',
      autoFixable: false,
    })
    expect(hint.toLowerCase()).toContain('brand settings')
  })

  it('M06: tells the user to regenerate/replace the image, not edit JSON-LD', () => {
    const hint = buildActionHint({
      id: 'schema-Article-image-width',
      category: 'schema',
      title: 'Article: image width',
      description: 'Primary image is 800px wide — Google requires at least 1200px.',
      autoFixable: false,
    })
    expect(hint.toLowerCase()).toContain('1200px')
    expect(hint.toLowerCase()).not.toContain('json-ld')
  })

  it('never returns vague "manual review required"', () => {
    const hint = buildActionHint({
      id: 'fact-grant-figure-1',
      category: 'grant-figure',
      title: 'Specific monetary cap stated',
      description: 'Found: "up to £350" — no citation',
      location: 'The OZEV grant covers up to £350',
      autoFixable: false,
      verificationStatus: 'no-citation',
    })
    expect(hint.toLowerCase()).not.toContain('manual review required')
    expect(hint.toLowerCase()).toMatch(/add a link|gov\.uk/)
  })

  it('points at the cited URL when figure is missing', () => {
    const hint = buildActionHint({
      id: 'fact-grant-figure-1',
      category: 'grant-figure',
      title: 'Financial figure',
      description: 'Found: "up to £350"',
      location: 'up to £350 towards a charger',
      autoFixable: false,
      citationUrl: 'https://www.gov.uk/ev-grant',
      verificationStatus: 'figure-missing',
    })
    expect(hint).toContain('https://www.gov.uk/ev-grant')
    expect(hint.toLowerCase()).toMatch(/update the sentence|find the current figure/)
  })

  it('withActionHints fills missing actionHint', () => {
    const [out] = withActionHints([{
      id: 'dated-claim-0',
      category: 'dated-policy',
      title: 'Dated claim',
      description: 'as of January 2024 grant…',
      location: 'as of January 2024 the grant covers 75%',
      autoFixable: false,
    }])
    expect(out.actionHint).toBeTruthy()
    expect(out.actionHint!.length).toBeGreaterThan(20)
  })
})

describe('panel-scores', () => {
  it('parses SEORANKO_SCORES meta without inventing zeros when values exist', () => {
    const panel = panelScoresFromMeta({
      eeatScore: 65,
      readabilityScore: 72,
      keywordDensity: 1.4,
      keywordDensityScore: 90,
    })
    expect(panel).toEqual({
      eeatScore: 65,
      readabilityScore: 72,
      keywordDensity: 1.4,
      keywordDensityScore: 90,
    })
  })

  it('computePanelScores is stable for the same HTML', () => {
    const html = '<h1>EV charger grant</h1><p>Written by Kamran Gul. According to GOV.UK the grant is useful. Last updated August 2026.</p><script type="application/ld+json">{"@type":"Person"}</script>'
    const a = computePanelScores(html, 'EV charger grant')
    const b = computePanelScores(html, 'EV charger grant')
    expect(a).toEqual(b)
    expect(a.eeatScore).toBeGreaterThan(0)
    expect(a.readabilityScore).toBeGreaterThan(0)
  })
})
