import type { FixtureManifest } from '../types'

/** Fixture B — dead links, orphan, deep page, utm dedupe. */
export const brokenLinksAndOrphans: FixtureManifest = {
  id: 'broken-links-and-orphans',
  description:
    '404 internal link, orphan in sitemap, depth>5 page, tracking-param duplicate of alive URL.',
  origin: 'https://fixture-b.test',
  seedPath: '/',
  robotsTxt: 'User-agent: *\nAllow: /\n',
  pages: [
    { path: '/', file: 'index.html', depth: 0 },
    { path: '/alive.html', file: 'alive.html', depth: 1 },
    { path: '/orphan.html', file: 'orphan.html', depth: 1 },
    { path: '/depth-1.html', file: 'depth-1.html', depth: 1 },
    { path: '/depth-2.html', file: 'depth-2.html', depth: 2 },
    { path: '/depth-3.html', file: 'depth-3.html', depth: 3 },
    { path: '/depth-4.html', file: 'depth-4.html', depth: 4 },
    { path: '/depth-5.html', file: 'depth-5.html', depth: 5 },
    { path: '/depth-6.html', file: 'depth-6.html', depth: 6 },
    { path: '/missing-page', file: 'index.html', depth: 1, httpStatus: 404, excludeAsNon200: true },
  ],
  sitemapPaths: [
    '/',
    '/alive.html',
    '/orphan.html',
    '/depth-1.html',
    '/depth-2.html',
    '/depth-3.html',
    '/depth-4.html',
    '/depth-5.html',
    '/depth-6.html',
  ],
  linkResolveMap: {
    'https://fixture-b.test/': { status: 200 },
    'https://fixture-b.test/alive.html': { status: 200 },
    'https://fixture-b.test/orphan.html': { status: 200 },
    'https://fixture-b.test/missing-page': { status: 404 },
    'https://fixture-b.test/depth-1.html': { status: 200 },
    'https://fixture-b.test/depth-2.html': { status: 200 },
    'https://fixture-b.test/depth-3.html': { status: 200 },
    'https://fixture-b.test/depth-4.html': { status: 200 },
    'https://fixture-b.test/depth-5.html': { status: 200 },
    'https://fixture-b.test/depth-6.html': { status: 200 },
  },
  expectations: {
    pages: [
      { path: '/', verdict: 'INDEXABLE', canonicalPassed: true },
      { path: '/alive.html', verdict: 'INDEXABLE', canonicalPassed: true },
      { path: '/orphan.html', verdict: 'AT_RISK', canonicalPassed: true },
      { path: '/depth-6.html', verdict: 'AT_RISK', canonicalPassed: true },
    ],
    followUps: [{ kind: 'non_200', affectedPath: '/missing-page' }],
    sitemap: {
      mustInclude: ['/', '/alive.html'],
      mustExclude: ['/missing-page', '/orphan.html'],
    },
    fixAgent: {
      autoKindsOnGithub: ['remove-dead-link'],
      humanKindsOnGithub: ['missing-page-content'],
    },
    linkGraph: {
      mustFind: [
        { ruleId: 'L01', urlIncludes: '/missing-page' },
        { ruleId: 'L21', urlIncludes: '/orphan.html' },
        { ruleId: 'L22', urlIncludes: '/depth-6.html' },
      ],
      mustNotFindRuleIds: ['L00_JS_SUSPECTED'],
    },
  },
}
