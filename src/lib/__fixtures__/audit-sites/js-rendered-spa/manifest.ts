import type { FixtureManifest } from '../types'

/** Fixture D — legitimate SPA shell; must flag JS suspicion, not false structural defects. */
export const jsRenderedSpa: FixtureManifest = {
  id: 'js-rendered-spa',
  description:
    'Served HTML has substantial text but <3 internal anchors. Must raise L00 and suppress L21/L23.',
  origin: 'https://fixture-d.test',
  seedPath: '/',
  robotsTxt: 'User-agent: *\nAllow: /\n',
  pages: [{ path: '/', file: 'index.html', depth: 0 }],
  sitemapPaths: ['/', '/dashboard'],
  linkResolveMap: {
    'https://fixture-d.test/': { status: 200 },
    'https://fixture-d.test/dashboard': { status: 200 },
  },
  expectations: {
    pages: [{ path: '/', verdict: 'INDEXABLE', canonicalPassed: true }],
    sitemap: {
      mustInclude: ['/'],
      mustExclude: [],
    },
    spa: {
      jsSuspected: true,
      suppressRuleIds: ['L21', 'L23'],
    },
    linkGraph: {
      mustFind: [{ ruleId: 'L00_JS_SUSPECTED' }],
      mustNotFindRuleIds: ['L21', 'L23'],
    },
  },
}
