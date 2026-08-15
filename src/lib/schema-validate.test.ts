import { describe, it, expect } from 'vitest'
import { assertSchemaCompleteness } from './schema-validate'

describe('assertSchemaCompleteness', () => {
  it('blocks when Article.image is missing regardless of brand config', () => {
    const result = assertSchemaCompleteness({
      imageUrl: undefined,
      organizationLogoUrl: 'https://example.com/logo.png',
      logoOmittedReason: undefined,
      hasBrandSettingsConfigured: false,
    })
    expect(result.blocked).toBe(true)
    expect(result.reasons.some(r => r.includes('Article.image'))).toBe(true)
  })

  it('blocks when a configured brand has no resolvable Organization.logo', () => {
    const result = assertSchemaCompleteness({
      imageUrl: 'https://example.com/hero.webp',
      organizationLogoUrl: undefined,
      logoOmittedReason: 'no brand_settings row and no derivable domain',
      hasBrandSettingsConfigured: true,
    })
    expect(result.blocked).toBe(true)
    expect(result.reasons.some(r => r.includes('Organization.logo'))).toBe(true)
    expect(result.reasons.join(' ')).toContain('no brand_settings row')
  })

  it('does NOT block a brand-less/unconfigured brand for a missing logo (default state for a new brand)', () => {
    const result = assertSchemaCompleteness({
      imageUrl: 'https://example.com/hero.webp',
      organizationLogoUrl: undefined,
      logoOmittedReason: 'no brand_settings row',
      hasBrandSettingsConfigured: false,
    })
    expect(result.blocked).toBe(false)
    expect(result.reasons).toHaveLength(0)
  })

  it('passes cleanly when both Article.image and Organization.logo are valid https URLs', () => {
    const result = assertSchemaCompleteness({
      imageUrl: 'https://example.com/hero.webp',
      organizationLogoUrl: 'https://logo.clearbit.com/example.com',
      logoOmittedReason: undefined,
      hasBrandSettingsConfigured: true,
    })
    expect(result.blocked).toBe(false)
    expect(result.reasons).toHaveLength(0)
  })

  it('rejects a non-https URL as invalid', () => {
    const result = assertSchemaCompleteness({
      imageUrl: 'http://example.com/hero.webp',
      organizationLogoUrl: 'https://logo.clearbit.com/example.com',
      logoOmittedReason: undefined,
      hasBrandSettingsConfigured: false,
    })
    expect(result.blocked).toBe(true)
  })
})
