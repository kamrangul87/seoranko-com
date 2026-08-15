// Regression: merge-artifact typos (Network.s, 22kW. units) + SEO meta description tag.
// Usage: npx tsx scripts/test-merge-artifact-and-meta.ts

import {
  applyDeterministicMergeFixes,
  detectMergeArtifacts,
  repairAllMergeArtifacts,
} from '../src/lib/merge-artifact-repair'
import { runQualityGate } from '../src/lib/article-quality-gate'
import { buildSocialMetaTags } from '../src/lib/social-meta-tags'

const CORRUPT_PROSE = `
  <h1>EV Charger Guide</h1>
  <p>Corroborated by industry reporting from the Energy Network.s Association,
  home chargers typically deliver 7kW rather than the headline-grabbing 22kW. units.</p>
  <p>Written by Kamran Gul for ev.autodun.com.</p>
`

async function main() {
  // --- Deterministic repair ---
  const { content: fixed, fixesMade } = applyDeterministicMergeFixes(CORRUPT_PROSE)
  if (!fixed.includes('Energy Networks Association')) {
    console.error('FAIL: expected "Energy Networks Association", got:', fixed)
    process.exit(1)
  }
  if (!fixed.includes('22kW units')) {
    console.error('FAIL: expected "22kW units", got:', fixed)
    process.exit(1)
  }
  if (fixed.includes('Network.s') || fixed.includes('22kW. units')) {
    console.error('FAIL: corruption still present after deterministic fix')
    process.exit(1)
  }
  console.log(`PASS: deterministic merge fixes (${fixesMade} fixes)`)

  // --- Detection still finds pre-fix patterns ---
  const detected = detectMergeArtifacts(CORRUPT_PROSE)
  if (detected.length < 2) {
    console.error('FAIL: expected at least 2 merge artifacts detected, got', detected.length)
    process.exit(1)
  }
  console.log(`PASS: detectMergeArtifacts found ${detected.length} artifact(s)`)

  // --- Quality Gate flags corruption before repair ---
  const beforeQg = await runQualityGate(CORRUPT_PROSE, {
    brand: 'ev.autodun.com',
    keyword: 'ev charger',
    authorName: 'Kamran Gul',
    registeredLinkDomains: [],
    minWordCount: 10,
    expectOrganizationLogo: false,
  })
  const mergeIssues = beforeQg.issues.filter(i => i.category === 'merge-artifact')
  if (mergeIssues.length === 0) {
    console.error('FAIL: Quality Gate should flag merge-artifact corruption')
    process.exit(1)
  }
  console.log(`PASS: Quality Gate flags ${mergeIssues.length} merge-artifact issue(s) on corrupt text`)

  // --- Quality Gate clean after repair ---
  const afterQg = await runQualityGate(fixed, {
    brand: 'ev.autodun.com',
    keyword: 'ev charger',
    authorName: 'Kamran Gul',
    registeredLinkDomains: [],
    minWordCount: 10,
    expectOrganizationLogo: false,
  })
  const mergeAfter = afterQg.issues.filter(i => i.category === 'merge-artifact')
  if (mergeAfter.length > 0) {
    console.error('FAIL: merge-artifact issues remain after fix:', mergeAfter)
    process.exit(1)
  }
  console.log('PASS: no merge-artifact issues after deterministic repair')

  // --- Meta description tag ---
  const tags = buildSocialMetaTags({
    title: 'EV Charger Guide',
    description: 'A practical guide to home EV charging in the UK.',
    url: 'https://ev.autodun.com/blog/ev-charger-guide',
    imageUrl: 'https://ev.autodun.com/hero.jpg',
  })
  if (!tags.includes('<meta name="description" content="')) {
    console.error('FAIL: missing <meta name="description"> in social meta tags')
    process.exit(1)
  }
  if (!tags.includes('og:description')) {
    console.error('FAIL: og:description should still be present')
    process.exit(1)
  }
  // Meta description should appear before OG tags (standard SEO ordering)
  const descIdx = tags.indexOf('name="description"')
  const ogIdx = tags.indexOf('og:type')
  if (descIdx === -1 || descIdx > ogIdx) {
    console.error('FAIL: meta description should precede Open Graph tags')
    process.exit(1)
  }
  console.log('PASS: <meta name="description"> present in buildSocialMetaTags output')

  // repairAllMergeArtifacts should not need Claude when deterministic fixes suffice
  // (mock would be ideal; here we just verify deterministic path leaves nothing to detect)
  const remaining = detectMergeArtifacts(fixed)
  if (remaining.length > 0) {
    console.log('NOTE: artifacts remain after deterministic fix — Claude repair would run in pipeline:', remaining.map(a => a.matchedText))
  }

  console.log('ALL PASS')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
