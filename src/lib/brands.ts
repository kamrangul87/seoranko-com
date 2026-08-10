// src/lib/brands.ts
// Shared brand picker options — previously duplicated only inside
// LinkRegistryManager.tsx; extracted so BrandLogoManager.tsx (and any
// future brand-scoped settings UI) can't drift out of sync with it.

export const BRAND_OPTIONS = [
  { value: 'autodun', label: '🚗 Autodun', color: '#FF6B2C' },
  { value: 'seoranko', label: '📊 SEORANKO', color: '#6366F1' },
  { value: 'fitford', label: '💪 FitFord', color: '#10B981' },
]
