import { describe, expect, it } from 'vitest'
import {
  classifyAlternateCanonical,
  classifyNotFound404,
} from './classify-other'

describe('classifyAlternateCanonical', () => {
  it('healthy when target 200 and self-canonical', () => {
    const r = classifyAlternateCanonical({
      pageUrl: 'https://example.com/a',
      canonicalTargetUrl: 'https://example.com/b',
      targetStatus: 200,
      targetSelfCanonical: true,
    })
    expect(r.problem).toBe(false)
  })

  it('PROBLEM when target not self-canonical', () => {
    const r = classifyAlternateCanonical({
      pageUrl: 'https://example.com/a',
      canonicalTargetUrl: 'https://example.com/b',
      targetStatus: 200,
      targetSelfCanonical: false,
    })
    expect(r.problem).toBe(true)
  })
})

describe('classifyNotFound404', () => {
  it('healthy when not in sitemap and not linked', () => {
    const r = classifyNotFound404({
      pageUrl: 'https://example.com/old',
      liveStatus: 404,
      inSitemap: false,
      linkedInternally: false,
      gscValidationPassed: true,
    })
    expect(r.problem).toBe(false)
    expect(r.detail).toMatch(/Validation passed/)
  })

  it('PROBLEM when still in sitemap', () => {
    const r = classifyNotFound404({
      pageUrl: 'https://example.com/old',
      liveStatus: 404,
      inSitemap: true,
      linkedInternally: false,
    })
    expect(r.problem).toBe(true)
    expect(r.relatedTopics).toContain('26')
  })
})
