import { describe, expect, it } from 'vitest'
import { LABEL_MAX_CHARS, shortNodeLabel } from './labels'

describe('shortNodeLabel', () => {
  it('prefers the page title, truncated at about 24 characters', () => {
    expect(
      shortNodeLabel({
        path: '/blog/electric-car-charger-map-uk.html',
        title: 'Electric Car Charger Map UK',
      }),
    ).toBe('Electric Car Charger Ma…')
    expect(
      shortNodeLabel({
        path: '/about',
        title: 'About Autodun',
      }),
    ).toBe('About Autodun')
  })

  it('falls back to the last path segment without .html or /blog/', () => {
    expect(
      shortNodeLabel({
        path: '/blog/electric-car-charger-map-uk.html',
        title: null,
      }),
    ).toBe('electric-car-charger-ma…')
    expect(
      shortNodeLabel({
        path: '/blog/mot-cost-uk-2026.html',
      }),
    ).toBe('mot-cost-uk-2026')
    expect(shortNodeLabel({ path: '/about' })).toBe('about')
  })

  it('decodes stored HTML entities in titles before truncating', () => {
    expect(
      shortNodeLabel({
        path: '/contact',
        title: 'Vehicle History &amp; Support Team',
      }),
    ).toBe('Vehicle History & Suppo…')
    expect(
      shortNodeLabel({
        path: '/contact',
        title: 'Vehicle History &amp; Support Team',
      }),
    ).not.toContain('&amp;')
  })

  it('labels the homepage as home', () => {
    expect(shortNodeLabel({ path: '/' })).toBe('home')
    expect(shortNodeLabel({ path: '', title: null })).toBe('home')
  })

  it('never returns a string longer than 24 characters plus ellipsis', () => {
    const label = shortNodeLabel({
      path: '/blog/why-uk-councils-are-flying-blind-on-ev-charging-infrastructure.html',
    })
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBe(LABEL_MAX_CHARS)
  })
})
