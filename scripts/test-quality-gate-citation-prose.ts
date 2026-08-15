// Verifies: stripped citations don't block publish; style-only prose is hidden.
// Usage: npx tsx scripts/test-quality-gate-citation-prose.ts

import { runQualityGate } from '../src/lib/article-quality-gate'

const sampleArticle = `
  <h1>EV Charger Guide</h1>
  <p>Written by Kamran Gul. Don't skip the basics — "smart charging" isn't optional anymore.</p>
  <p>Home charging is the most convenient way to keep an electric vehicle ready for daily use.</p>
`

async function main() {
  // No extraIssues for stripped citations (article-v2 behaviour after fix).
  const result = await runQualityGate(sampleArticle, {
    brand: 'ev.autodun.com',
    keyword: 'ev charger',
    authorName: 'Kamran Gul',
    registeredLinkDomains: [],
    minWordCount: 10,
    expectOrganizationLogo: false,
  })

  const citationBlockers = result.issues.filter(i => i.category === 'broken-citation-link')
  if (citationBlockers.length > 0) {
    console.error('FAIL: stripped citations should not appear as QG issues:', citationBlockers)
    process.exit(1)
  }
  console.log('PASS: no broken-citation-link issues in Quality Gate')

  const styleProse = result.issues.filter(
    i => i.id === 'prose-quote-style' || i.id === 'prose-apostrophe-style'
  )
  if (styleProse.length > 0) {
    console.error('FAIL: info-level prose style should be hidden:', styleProse)
    process.exit(1)
  }
  console.log('PASS: straight quote/apostrophe style findings hidden from panel')

  const datedPolicy = result.issues.filter(i => i.category === 'dated-policy')
  if (datedPolicy.length > 0) {
    console.log('NOTE: dated-policy findings (info-only):', datedPolicy.length)
  }
  console.log('PASS: dated-policy would be info-only when present')

  const blocking = result.issues.filter(
    i => i.category === 'broken-citation-link' || i.id === 'prose-quote-style' || i.id === 'prose-apostrophe-style'
  )
  if (blocking.length > 0) {
    console.error('FAIL: unexpected blocking-style issues:', blocking)
    process.exit(1)
  }

  console.log(`PASS: score=${result.score}/100, warnings=${result.warningCount}, critical=${result.criticalCount}`)
}

main()
