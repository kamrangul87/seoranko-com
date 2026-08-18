import { describe, it, expect } from 'vitest'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
  DATED_POLICY_SEVERITY,
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
})

describe('DATED_POLICY_SEVERITY', () => {
  it('documents info severity for Phase 5 convergence (Phase 1 does not change scoring)', () => {
    expect(DATED_POLICY_SEVERITY).toBe('info')
  })
})
