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
    href: '/dashboard/findings',
    label: 'Audit',
    description: "Crawl your site and fix what's found",
  },
  {
    href: '/dashboard/links',
    label: 'Link map',
    description: 'Internal links as they are crawled',
  },
  {
    href: '/dashboard/receipts',
    label: 'Receipts',
    description: 'Verified fixes you can share',
  },
  {
    href: '/dashboard/experiments',
    label: 'Google status',
    description: 'What Google sees',
  },
  {
    href: '/dashboard/reports',
    label: 'Reports',
    description: 'Weekly Search Console summary',
  },
  {
    href: '/dashboard/audit',
    label: 'Diagnostics',
    description: 'Indexing and link detail',
  },
  {
    href: '/dashboard/install',
    label: 'Install',
    description: 'Add the script to your site',
  },
  {
    href: '/dashboard/billing',
    label: 'Billing',
    description: 'Plan and invoices',
  },
] as const

export type DashboardNavItem = (typeof NAV_ITEMS)[number]
