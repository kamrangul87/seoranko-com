/**
 * Bare homepage URLs must not bind as claim-evidence sources.
 * GOV.UK (and other path-bearing) citations must still bind when they
 * actually state the figure.
 */
import { describe, it, expect } from 'vitest'
import {
  isBareDomainRootUrl,
  describeInternalLinkRegistryGap,
  textContainsFinancialFigure,
} from './bare-domain-url'
import { evaluateClaimEvidence } from './claim-evidence'
import { collectFactualClaimIssues } from './article-quality-gate'
import { injectMissingInternalLinks } from './inject-internal-links'

const GOV_GRANT =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'

describe('isBareDomainRootUrl', () => {
  it('treats origin-only URLs (with or without trailing slash / www) as roots', () => {
    expect(isBareDomainRootUrl('https://autodun.com')).toBe(true)
    expect(isBareDomainRootUrl('https://autodun.com/')).toBe(true)
    expect(isBareDomainRootUrl('https://www.autodun.com')).toBe(true)
    expect(isBareDomainRootUrl('http://example.com')).toBe(true)
    expect(isBareDomainRootUrl('autodun.com')).toBe(true)
  })

  it('treats path-bearing URLs as specific pages', () => {
    expect(isBareDomainRootUrl('https://autodun.com/running-costs')).toBe(false)
    expect(isBareDomainRootUrl(GOV_GRANT)).toBe(false)
    expect(isBareDomainRootUrl('https://mot.autodun.com/check')).toBe(false)
  })
})

describe('bare homepage is non-citable for financial claims', () => {
  it('£350 with only a co-located homepage link is UNSUPPORTED, not PARTIALLY_SUPPORTED', () => {
    const html = `<article>
      <p>Eligible renters can claim up to £350 toward installation.
      See <a href="https://autodun.com">Autodun</a>.</p>
    </article>`
    const ev = evaluateClaimEvidence(html).find((e) => /£350/i.test(e.figureText || ''))
    expect(ev).toBeTruthy()
    expect(ev!.source).toBeNull()
    expect(ev!.status).toBe('UNSUPPORTED')
    expect(ev!.status).not.toBe('PARTIALLY_SUPPORTED')

    const issues = collectFactualClaimIssues(html)
    const fig = issues.find((i) => /£350/.test(i.figureText || '') || /£350/.test(i.title))
    expect(fig).toBeTruthy()
    expect(fig!.citationUrl).toBeFalsy()
    expect(fig!.title).not.toMatch(/Figure not confirmed in cited context/i)
  })

  it('£350 with a real GOV.UK link stating the figure is still SUPPORTED', () => {
    const html = `<article>
      <p>Eligible businesses can claim up to £350 towards chargepoint hardware via the
      <a href="${GOV_GRANT}">GOV.UK low-emission vehicle grants</a> collection.</p>
    </article>`
    const ev = evaluateClaimEvidence(html).find((e) => /£350/i.test(e.figureText || ''))
    expect(ev).toBeTruthy()
    expect(ev!.status).toBe('SUPPORTED')
    expect(ev!.source?.url).toBe(GOV_GRANT)
    expect(ev!.source?.authority).toBe('official')

    const issues = collectFactualClaimIssues(html)
    const fig = issues.find((i) => /£350/.test(i.figureText || '') || /£350/.test(i.title))
    expect(fig?.severity).not.toBe('critical')
    expect(fig?.citationUrl).toBe(GOV_GRANT)
  })

  it('homepage plus a specific page in the same para still binds the specific page, not the root', () => {
    const html = `<article>
      <p>Hardware costs £800. See the
      <a href="https://autodun.com">home</a> and the
      <a href="https://autodun.com/ev-charger-costs">EV charger costs guide</a>.</p>
    </article>`
    const ev = evaluateClaimEvidence(html).find((e) => e.figureText === '£800')
    expect(ev).toBeTruthy()
    expect(ev!.source?.url).toBe('https://autodun.com/ev-charger-costs')
    expect(ev!.source?.url).not.toBe('https://autodun.com')
  })
})

describe('internal-link injection skips homepage wrap in figure paragraphs', () => {
  it('does not wrap a homepage href around a brand mention inside a £ paragraph', () => {
    const html = `<p>Eligible renters can claim up to £350 with help from Autodun.</p>
      <p>Kamran Gul is the founder of Autodun.</p>`
    const { html: out, injected } = injectMissingInternalLinks(html, [{
      url: 'https://autodun.com',
      anchorText: 'Autodun',
      context: 'Brand home',
    }])
    const firstPara = out.match(/<p>Eligible renters[\s\S]*?<\/p>/)![0]
    expect(firstPara).not.toContain('href="https://autodun.com"')
    expect(out).toMatch(/founder of <a href="https:\/\/autodun\.com"/)
    expect(injected).toContain('https://autodun.com')
  })

  it('still wraps a specific internal page even next to a figure', () => {
    const html = `<p>Check running costs on the Autodun costs guide — around £800.</p>`
    const { html: out, injected } = injectMissingInternalLinks(html, [{
      url: 'https://autodun.com/running-costs',
      anchorText: 'Autodun costs guide',
      context: 'Running costs',
    }])
    expect(injected).toContain('https://autodun.com/running-costs')
    expect(out).toContain('href="https://autodun.com/running-costs"')
  })
})

describe('describeInternalLinkRegistryGap', () => {
  it('surfaces homepage-only registry as a missing specific-page gap', () => {
    const note = describeInternalLinkRegistryGap({
      brand: 'example.com',
      keyword: 'EV charger costs',
      registeredUrls: ['https://example.com', 'https://example.com/'],
      eligibleUrls: ['https://example.com'],
    })
    expect(note).toBeTruthy()
    expect(note).toMatch(/only lists the site homepage/i)
    expect(note).toMatch(/Link Registry/)
    expect(note).not.toMatch(/autodun/i)
  })

  it('is silent when a specific page is registered and eligible', () => {
    const note = describeInternalLinkRegistryGap({
      brand: 'example.com',
      keyword: 'EV charger costs',
      registeredUrls: ['https://example.com', 'https://example.com/running-costs'],
      eligibleUrls: ['https://example.com/running-costs'],
    })
    expect(note).toBeUndefined()
  })
})

describe('textContainsFinancialFigure', () => {
  it('detects currency and percent figures', () => {
    expect(textContainsFinancialFigure('up to £350 toward installation')).toBe(true)
    expect(textContainsFinancialFigure('40% of homeowners wait')).toBe(true)
    expect(textContainsFinancialFigure('Kamran is the founder of the site')).toBe(false)
  })
})
