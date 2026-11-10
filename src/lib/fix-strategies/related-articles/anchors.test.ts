import { describe, expect, it } from 'vitest'
import {
  cleanRelatedAnchor,
  escapeHtmlAttr,
  escapeHtmlText,
} from './anchors'

describe('cleanRelatedAnchor', () => {
  it('uses the target H1, not a 2-word slice (EV charging)', () => {
    const anchor = cleanRelatedAnchor({
      h1: 'EV charging reliability in the UK: what the 99% rule covers — and what it doesn’t',
      title:
        'EV Charging Reliability UK: What the 99% Rule Covers — and What It Doesn’t',
      href: '/blog/ev-charging-reliability-uk.html',
    })
    expect(anchor).not.toBe('EV charging')
    expect(anchor.toLowerCase()).toMatch(/ev charging reliability/)
    expect(anchor.endsWith(':')).toBe(false)
    expect(anchor.length).toBeLessThanOrEqual(60)
  })

  it('never ends on a colon after MOT Changes 2026:', () => {
    const anchor = cleanRelatedAnchor({
      h1: 'MOT Changes 2026: DVSA Updates, New Rules & What UK Drivers Need to Know',
      title:
        'MOT Changes 2026 – DVSA Updates, New Rules & What UK Drivers Need to Know | Autodun',
      href: '/blog/mot-changes-2026-dvsa-updates.html',
    })
    expect(anchor).not.toBe('MOT Changes 2026:')
    expect(anchor.endsWith(':')).toBe(false)
    expect(anchor).toMatch(/MOT Changes 2026/i)
    expect(anchor).toMatch(/DVSA Updates/i)
    expect(anchor).not.toMatch(/What UK Drivers$/i)
    expect(anchor.length).toBeGreaterThan(16)
    expect(anchor.length).toBeLessThanOrEqual(60)
  })

  it('strips a site-name suffix and cuts at a word boundary', () => {
    const long =
      'How to check a vehicle MOT history in the United Kingdom using the free DVSA service | Autodun'
    const anchor = cleanRelatedAnchor({
      h1: long,
      title: long,
      href: '/blog/mot-history-check-uk.html',
    })
    expect(anchor).not.toMatch(/Autodun/i)
    expect(anchor.length).toBeLessThanOrEqual(60)
    expect(anchor.endsWith(' ')).toBe(false)
    expect(anchor).not.toMatch(/\s\w$/)
  })

  it('drops a dangling parenthetical instead of leaving an unclosed (', () => {
    const anchor = cleanRelatedAnchor({
      h1: 'How to check a vehicle’s MOT history in the UK (free DVSA MOT check)',
      title: 'Free MOT History Check UK: How to Use the DVSA Service',
      href: '/blog/mot-history-check-uk.html',
    })
    expect(anchor).not.toMatch(/\(free DVSA/i)
    expect(anchor).not.toMatch(/[(\[]$/)
    expect(anchor.split('(').length).toBe(anchor.split(')').length)
    expect(anchor.split('[').length).toBe(anchor.split(']').length)
    expect(anchor).toMatch(/MOT history/i)
    expect(anchor.length).toBeLessThanOrEqual(60)
  })

  it('drops an unclosed quote or bracket after truncation', () => {
    const quoted = cleanRelatedAnchor({
      h1: 'MOT advisories explained: “Dangerous, Major, Minor and what to fix next”',
      href: '/blog/mot-advisories-explained-uk.html',
    })
    expect(quoted).not.toMatch(/[“"][^”"]*$/)
    const bracketed = cleanRelatedAnchor({
      h1: 'MOT retest costs UK 2026: when retests are free [DVSA rules and exceptions]',
      href: '/blog/mot-retest-cost-uk-2026.html',
    })
    expect(bracketed).not.toMatch(/\[[^\]]*$/)
    expect(bracketed.split('[').length).toBe(bracketed.split(']').length)
  })

  it('falls back to a path-derived phrase when the stored anchor is a 2-word stub', () => {
    const anchor = cleanRelatedAnchor({
      h1: 'EV charging',
      title: 'EV charging',
      href: '/blog/ev-charging-reliability-uk.html',
    })
    expect(anchor).not.toBe('EV charging')
    expect(anchor.toLowerCase()).toMatch(/reliability/)
  })
})

describe('HTML escaping', () => {
  it('escapes quotes, ampersands, < and > in text and attributes', () => {
    expect(escapeHtmlText(`A & B <C> "D"`)).toBe('A &amp; B &lt;C&gt; "D"')
    expect(escapeHtmlAttr(`A & B <C> "D"`)).toBe(
      'A &amp; B &lt;C&gt; &quot;D&quot;',
    )
  })
})
