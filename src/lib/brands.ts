// src/lib/brands.ts
// Brand picker for link registry (preset options). Write page uses free-text brand + domain.

export const BRAND_OPTIONS = [
  { value: 'autodun', label: '🚗 Autodun', color: '#FF6B2C' },
  { value: 'seoranko', label: '📊 SEORANKO', color: '#6366F1' },
  { value: 'fitford', label: '💪 FitFord', color: '#10B981' },
]

/** Known preset domains — Write page accepts any user-typed domain. */
export const BRAND_DOMAINS: Record<string, string> = {
  autodun: 'autodun.com',
  seoranko: 'seoranko.com',
  fitford: 'fitford.com',
}

export const WRITE_BRAND_STORAGE_KEY = 'seoranko_write_brand'
export const WRITE_DOMAIN_STORAGE_KEY = 'seoranko_write_domain'

/** Normalise a user-typed domain (strip protocol/path). */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}
