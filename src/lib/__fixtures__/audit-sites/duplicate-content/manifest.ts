import type { FixtureManifest } from '../types'

/** Fixture C — near-duplicate cohort + one unique page. */
export const duplicateContent: FixtureManifest = {
  id: 'duplicate-content',
  description:
    'Three near-identical /blog/:slug.html pages must form a duplicate cohort; /unique.html must not.',
  origin: 'https://fixture-c.test',
  seedPath: '/',
  robotsTxt: 'User-agent: *\nAllow: /\n',
  pages: [
    { path: '/', file: 'index.html', depth: 0 },
    { path: '/blog/post-a.html', file: 'post-a.html', depth: 1 },
    { path: '/blog/post-b.html', file: 'post-b.html', depth: 1 },
    { path: '/blog/post-c.html', file: 'post-c.html', depth: 1 },
    { path: '/unique.html', file: 'unique.html', depth: 1 },
  ],
  sitemapPaths: ['/', '/blog/post-a.html', '/blog/post-b.html', '/blog/post-c.html', '/unique.html'],
  expectations: {
    pages: [
      { path: '/', verdict: 'INDEXABLE', canonicalPassed: true },
      { path: '/unique.html', verdict: 'INDEXABLE', canonicalPassed: true },
      { path: '/blog/post-a.html', verdict: 'AT_RISK', canonicalPassed: true },
      { path: '/blog/post-b.html', verdict: 'AT_RISK', canonicalPassed: true },
      { path: '/blog/post-c.html', verdict: 'AT_RISK', canonicalPassed: true },
    ],
    sitemap: {
      // Near-duplicate AT_RISK posts are excluded from sitemap (INDEXABLE-only generation)
      mustInclude: ['/', '/unique.html'],
      mustExclude: ['/blog/post-a.html', '/blog/post-b.html', '/blog/post-c.html'],
    },
    duplicate: {
      flaggedPathPatternIncludes: '/blog/',
      uniquePathMustNotBeInFlaggedCohort: '/unique.html',
    },
    linkGraph: {
      mustFind: [],
      mustNotFindRuleIds: [],
    },
  },
}
