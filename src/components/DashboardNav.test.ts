import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from '@/lib/dashboard-nav-items'
import { LEGACY_DASHBOARD_ROUTES, isLegacyDashboardPath } from '@/lib/legacy-dashboard-routes'

const EXPECTED_HREFS = [
  '/dashboard',
  '/dashboard/settings',
  '/dashboard/audit',
  '/dashboard/findings',
  '/dashboard/experiments',
  '/dashboard/install',
  '/dashboard/billing',
] as const

describe('NAV_ITEMS (dashboard-focus)', () => {
  it('contains exactly the seven shipped hrefs and none of the legacy hrefs', () => {
    const hrefs = NAV_ITEMS.map((i) => i.href)
    expect(hrefs).toEqual([...EXPECTED_HREFS])
    for (const legacy of LEGACY_DASHBOARD_ROUTES) {
      expect(hrefs).not.toContain(legacy)
    }
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
