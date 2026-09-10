import { describe, expect, it } from 'vitest'
import { explainPublicCause } from './explanations'
import { PUBLIC_EXCLUSION_REASONS } from './types'
import { validatePublicDomainInput } from './validate-domain'

describe('public Index Diagnosis explanations', () => {
  it('has a template for every reason code', () => {
    for (const reason of PUBLIC_EXCLUSION_REASONS) {
      const copy = explainPublicCause(reason, 3, 'https://example.com/page')
      expect(copy.headline.length).toBeGreaterThan(5)
      expect(copy.explanation).toContain('https://example.com/page')
      expect(copy.explanation).toMatch(/3/)
    }
  })
})

describe('validatePublicDomainInput', () => {
  it('rejects localhost and private hosts', async () => {
    const r = await validatePublicDomainInput('http://localhost/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('private')
  })

  it('rejects IP literals', async () => {
    const r = await validatePublicDomainInput('8.8.8.8')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(['ip_literal', 'private', 'unresolvable']).toContain(r.code)
  })

  it('accepts a resolvable public domain', async () => {
    const r = await validatePublicDomainInput('example.com')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.normalizedUrl).toMatch(/^https:\/\/example\.com/)
      expect(r.domain).toBe('example.com')
    }
  })
})
