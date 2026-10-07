import { describe, expect, it } from 'vitest'
import {
  isPlatformPublicSuffixHost,
  shouldSkipWwwVariantProbe,
} from './platform-public-suffix'
import { generateVariant } from './duplicate-url-variants'

describe('platform public-suffix www skip', () => {
  it('recognises vercel.app / netlify.app / pages.dev / github.io hosts', () => {
    expect(isPlatformPublicSuffixHost('seoranko-fixture.vercel.app')).toBe(true)
    expect(isPlatformPublicSuffixHost('app.netlify.app')).toBe(true)
    expect(isPlatformPublicSuffixHost('docs.pages.dev')).toBe(true)
    expect(isPlatformPublicSuffixHost('org.github.io')).toBe(true)
    expect(isPlatformPublicSuffixHost('example.com')).toBe(false)
    expect(isPlatformPublicSuffixHost('www.example.com')).toBe(false)
  })

  it('skips inventing www under platform hosts but allows stripping www', () => {
    expect(shouldSkipWwwVariantProbe('seoranko-fixture.vercel.app')).toBe(true)
    expect(shouldSkipWwwVariantProbe('www.seoranko-fixture.vercel.app')).toBe(
      false,
    )
    expect(
      generateVariant(
        'https://seoranko-fixture.vercel.app/blog/',
        'www-non-www',
      ),
    ).toBeNull()
    expect(
      generateVariant('https://example.com/blog/', 'www-non-www')?.b,
    ).toBe('https://www.example.com/blog/')
  })
})
