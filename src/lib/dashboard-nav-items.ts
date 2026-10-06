/**
 * Shipped product nav — data only (no React / Supabase).
 * DashboardNav adds icons; tests and copy guards scan this list.
 */
export const NAV_ITEMS = [
  {
    href: '/dashboard',
    exact: true,
    label: 'Overview',
    description: 'Your setup at a glance',
  },
  {
    href: '/dashboard/settings',
    label: 'Sites',
    description: 'Domains and connections',
  },
  {
    href: '/dashboard/audit',
    label: 'Audit',
    description: 'Crawl your site',
  },
  {
    href: '/dashboard/findings',
    label: 'Findings',
    description: 'Problems found and their fixes',
  },
  {
    href: '/dashboard/experiments',
    label: 'Google status',
    description: 'What Google sees',
  },
  {
    href: '/dashboard/install',
    label: 'History',
    description: 'Past crawls and connection health',
  },
  {
    href: '/dashboard/billing',
    label: 'Billing',
    description: 'Plan and invoices',
  },
] as const

export type DashboardNavItem = (typeof NAV_ITEMS)[number]
