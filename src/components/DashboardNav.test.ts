import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from '@/lib/dashboard-nav-items'
import { LEGACY_DASHBOARD_ROUTES, isLegacyDashboardPath } from '@/lib/legacy-dashboard-routes'

const EXPECTED_HREFS = [
  '/dashboard',
  '/dashboard/settings',
  '/dashboard/findings',
  '/dashboard/experiments',
  '/dashboard/audit',
  '/dashboard/install',
  '/dashboard/billing',
] as const

const EXPECTED_LABELS = [
  'Overview',
  'Sites',
  'Audit',
  'Google status',
  'Diagnostics',
  'History',
  'Billing',
] as const

describe('NAV_ITEMS (dashboard-focus)', () => {
  it('contains exactly the seven shipped hrefs and none of the legacy hrefs', () => {
    const hrefs = NAV_ITEMS.map((i) => i.href)
    expect(hrefs).toEqual([...EXPECTED_HREFS])
    for (const legacy of LEGACY_DASHBOARD_ROUTES) {
      expect(hrefs).not.toContain(legacy)
    }
  })

  it('labels Audit→findings and Diagnostics→audit with no separate Findings item', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([...EXPECTED_LABELS])
    expect(NAV_ITEMS.find((i) => i.href === '/dashboard/findings')?.description).toBe(
      "Crawl your site and fix what's found",
    )
    expect(NAV_ITEMS.find((i) => i.href === '/dashboard/audit')?.description).toBe(
      'Indexing and link detail',
    )
  })

  it('has no Experimental section markers on items', () => {
    for (const item of NAV_ITEMS) {
      expect(item).not.toHaveProperty('experimental')
    }
  })
})

describe('LEGACY_DASHBOARD_ROUTES', () => {
  it('matches exact and nested legacy paths', () => {
    expect(isLegacyDashboardPath('/dashboard/write')).toBe(true)
    expect(isLegacyDashboardPath('/dashboard/keywords/serp-intent')).toBe(true)
    expect(isLegacyDashboardPath('/dashboard/site-audit/repair-order')).toBe(true)
    expect(isLegacyDashboardPath('/dashboard')).toBe(false)
    expect(isLegacyDashboardPath('/dashboard/audit')).toBe(false)
    expect(isLegacyDashboardPath('/dashboard/findings')).toBe(false)
    expect(isLegacyDashboardPath('/dashboard/billing')).toBe(false)
  })
})
