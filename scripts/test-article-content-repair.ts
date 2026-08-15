// Unit tests for saved-article content repair helpers.
// Usage: npx tsx scripts/test-article-content-repair.ts

import {
  repairArticleContent,
  injectMissingMetaDescription,
  articleNeedsRepair,
} from '../src/lib/article-content-repair'

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message)
    process.exit(1)
  }
}

const corrupt = `
<!-- META: Home EV charger guide for UK drivers -->
<p>Energy Network.s Association confirms 7kW is typical, not 22kW. units.</p>
<meta property="og:type" content="article" />
<meta property="og:description" content="Home EV charger guide for UK drivers." />
`

const result = repairArticleContent(corrupt, null)
assert(result.mergeFixes >= 2, 'expected at least 2 merge fixes')
assert(result.content.includes('Networks Association'), 'Network.s should become Networks')
assert(result.content.includes('22kW units'), '22kW. units should become 22kW units')
assert(result.metaDescriptionAdded, 'should inject meta description before og:type')
assert(result.content.includes('<meta name="description"'), 'meta description tag missing')
assert(!articleNeedsRepair(result.content), 'repaired content should not need further repair')

const alreadyOk = injectMissingMetaDescription(
  '<meta name="description" content="Already there" />',
  'ignored'
)
assert(!alreadyOk.added, 'should not duplicate existing meta description')

console.log('ALL PASS')
