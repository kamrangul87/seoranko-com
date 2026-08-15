// src/lib/brands.ts
// Shared brand picker options — previously duplicated only inside
// LinkRegistryManager.tsx; extracted so BrandLogoManager.tsx (and any
// future brand-scoped settings UI) can't drift out of sync with it.

export const BRAND_OPTIONS = [
  { value: 'autodun', label: '🚗 Autodun', color: '#FF6B2C' },
  { value: 'seoranko', label: '📊 SEORANKO', color: '#6366F1' },
  { value: 'fitford', label: '💪 FitFord', color: '#10B981' },
]

/** Primary domain sent to article-v2 as `domain` for schema, citations, links. */
export const BRAND_DOMAINS: Record<string, string> = {
  autodun: 'autodun.com',
  seoranko: 'seoranko.com',
  fitford: 'fitford.com',
}

export const DEFAULT_BRAND = BRAND_OPTIONS[0].value

export const WRITE_BRAND_STORAGE_KEY = 'seoranko_write_brand'
