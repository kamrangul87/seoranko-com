import { describe, it, expect } from 'vitest'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
  DATED_POLICY_SEVERITY,
  GRANT_FIGURE_CITATION_POLICY,
} from './quality-gate-policy'

describe('resolveLogoPolicy', () => {
  it('requires logo when brand_settings.logo_url is set', () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: 'https://cdn.example.com/logo.png' },
    })
    expect(policy.mode).toBe('require')
    expect(policy.logoUrl).toBe('https://cdn.example.com/logo.png')
    expect(expectOrganizationLogoFromPolicy(policy)).toBe(true)
  })

  it('omits logo requirement when brand row exists but logo_url is empty', () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: null },
    })
    expect(policy.mode).toBe('omit')
    expect(expectOrganizationLogoFromPolicy(policy)).toBe(false)
  })

  it('omits logo requirement when brand_settings is not configured', () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: false, logoUrl: null },
    })
    expect(policy.mode).toBe('omit')
    expect(expectOrganizationLogoFromPolicy(policy)).toBe(false)
  })

  it('treats whitespace-only logo_url as unset', () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: '   ' },
    })
    expect(policy.mode).toBe('omit')
  })

  it('forceRequire overrides omit even without logo_url', () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: false, logoUrl: null },
      forceRequire: true,
    })
    expect(policy.mode).toBe('require')
    expect(policy.reason).toMatch(/forceRequire/)
  })
})

describe('DATED_POLICY_SEVERITY', () => {
  it('is warning for every dated-policy finding (QG / recheck / Fix All)', () => {
    expect(DATED_POLICY_SEVERITY).toBe('warning')
  })
})

describe('GRANT_FIGURE_CITATION_POLICY', () => {
  it('documents document-level-once citation for repeated figures', () => {
    expect(GRANT_FIGURE_CITATION_POLICY).toBe('document-level-once')
  })
})
