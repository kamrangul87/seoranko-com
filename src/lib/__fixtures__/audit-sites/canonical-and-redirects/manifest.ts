import type { FixtureManifest } from '../types'

/** Fixture A — canonical consolidation + redirect graph defects. */
export const canonicalAndRedirects: FixtureManifest = {
  id: 'canonical-and-redirects',
  description:
    'Self-canonical OK page, directory→index.html consolidation (valid), index.html→directory (broken), single redirect, multi-hop chain, redirect loop.',
  origin: 'https://fixture-a.test',
  seedPath: '/',
  robotsTxt: 'User-agent: *\nAllow: /\n',
  pages: [
    { path: '/', file: 'index.html', depth: 0 },
    { path: '/ok.html', file: 'ok.html', depth: 1 },
    { path: '/blog', file: 'blog.html', depth: 1 },
    { path: '/blog/index.html', file: 'blog-index.html', depth: 1 },
  ],
  sitemapPaths: ['/', '/ok.html', '/blog', '/blog/index.html'],
  linkResolveMap: {
    'https://fixture-a.test/': { status: 200 },
    'https://fixture-a.test/ok.html': { status: 200 },
    'https://fixture-a.test/blog': { status: 200 },
    'https://fixture-a.test/blog/index.html': { status: 200 },
    'https://fixture-a.test/hop-a': { status: 301, location: 'https://fixture-a.test/hop-b' },
    'https://fixture-a.test/hop-b': { status: 301, location: 'https://fixture-a.test/hop-c' },
    'https://fixture-a.test/hop-c': { status: 200 },
    'https://fixture-a.test/single-old': { status: 302, location: 'https://fixture-a.test/single-new' },
    'https://fixture-a.test/single-new': { status: 200 },
    'https://fixture-a.test/loop-a': { status: 301, location: 'https://fixture-a.test/loop-b' },
    'https://fixture-a.test/loop-b': { status: 301, location: 'https://fixture-a.test/loop-a' },
  },
  expectations: {
    pages: [
      { path: '/', verdict: 'INDEXABLE', canonicalPassed: true },
      { path: '/ok.html', verdict: 'INDEXABLE', canonicalPassed: true, evidenceIncludes: 'self-reference' },
      {
        path: '/blog',
        verdict: 'INDEXABLE',
        canonicalPassed: true,
        evidenceIncludes: 'equivalent URL',
      },
      {
        path: '/blog/index.html',
        verdict: 'AT_RISK',
        canonicalPassed: false,
        evidenceIncludes: 'different same-host URL',
      },
    ],
    followUps: [{ kind: 'canonical', affectedPath: '/blog/index.html' }],
    followUpsAbsent: [],
    sitemap: {
      mustInclude: ['/', '/ok.html', '/blog'],
      mustExclude: ['/blog/index.html'],
    },
    fixAgent: {
      autoKindsOnGithub: ['redirect-canonical'],
      humanKindsOnGithub: [],
      serverOnlyKinds: ['redirect-canonical'],
    },
    linkGraph: {
      mustFind: [
        { ruleId: 'L04', urlIncludes: '/hop-a' },
        { ruleId: 'L05', urlIncludes: '/single-old' },
        { ruleId: 'L03', urlIncludes: '/loop-a' },
      ],
      mustNotFindRuleIds: ['L00_JS_SUSPECTED'],
    },
  },
}
