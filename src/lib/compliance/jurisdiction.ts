/**
 * Per-site jurisdiction for topic 72. Explicit owner setting — never a silent
 * country default, and never auto-written legal text.
 */

export const SITE_JURISDICTION_OPTIONS = [
  { value: 'UK', label: 'United Kingdom' },
  { value: 'EU', label: 'European Union' },
  { value: 'US', label: 'United States' },
] as const

export type SiteJurisdiction = (typeof SITE_JURISDICTION_OPTIONS)[number]['value']

const ALLOWED = new Set<string>(SITE_JURISDICTION_OPTIONS.map((o) => o.value))

export function normalizeSiteJurisdiction(
  raw: string | null | undefined,
): SiteJurisdiction | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (ALLOWED.has(v)) return v as SiteJurisdiction
  const upper = v.toUpperCase()
  if (upper === 'GB' || upper === 'UNITED KINGDOM') return 'UK'
  if (upper === 'UNITED STATES' || upper === 'USA') return 'US'
  if (upper === 'EUROPEAN UNION' || upper === 'EEA') return 'EU'
  return null
}

export function jurisdictionSettingsHref(siteId?: string | null): string {
  const hash = siteId ? `site-jurisdiction-${siteId}` : 'site-jurisdiction'
  return `/dashboard/settings#${hash}`
}

export const JURISDICTION_NOT_SET_VERDICT = 'human-review-jurisdiction-not-set'
