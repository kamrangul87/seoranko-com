/**
 * Overview (/dashboard) checklist + crawl summary copy.
 * Kept separate from the page file so owner-copy tests can scan without
 * pulling in client-only React / Supabase imports.
 */
export const DASHBOARD_OVERVIEW_COPY = {
  title: 'Your setup',
  lead: 'Connect a site, crawl it, then review what needs fixing.',
  steps: [
    {
      id: 'site',
      label: 'Add your site',
      href: '/dashboard/settings',
      actionLabel: 'Add site',
      detail: 'Add the domain you manage.',
    },
    {
      id: 'github',
      label: 'Connect GitHub',
      href: '/dashboard/settings',
      actionLabel: 'Connect',
      detail: 'Optional — needed for fixes committed to your repo.',
      optional: true,
    },
    {
      id: 'crawl',
      label: 'Run your first crawl',
      href: '/dashboard/audit',
      actionLabel: 'Start crawl',
      detail: 'Crawl your site to find problems.',
    },
    {
      id: 'finding',
      label: 'Review findings',
      href: '/dashboard/findings',
      actionLabel: 'Open findings',
      detail: 'See problems found and their fixes.',
    },
  ],
  crawlSummaryTitle: 'Latest crawl',
  openFindingsLabel: 'Open findings',
  bucketLabels: {
    actionable: 'Actionable',
    informational: 'Informational',
    internal: 'Internal',
  },
  lastCrawlLabel: 'Last crawl',
  doneLabel: 'Done',
  notDoneLabel: 'Not done',
  optionalSuffix: 'optional',
} as const
