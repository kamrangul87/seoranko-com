// Verifies RULE 1 (COPY_ERROR_PATTERNS) does not false-positive on HTML
// markup/attribute values after stripHtmlForTextChecks was wired in.
// Usage: npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' scripts/test-quality-gate-html-strip.ts

import { runQualityGate } from '../src/lib/article-quality-gate'

const sampleArticle = `
  <h1>EV Charger Station UK</h1>
  <p>Written by Kamran Gul. According to GOV.UK, uptake is rising.</p>
  <img src="https://example.com/hero.jpg" alt="EV charger"
       style="border-radius:0 8px 8px 0; margin:0 auto" />
  <p>Public charging points are now common across UK cities, and drivers
  can find a nearby ev charger station using most major mapping apps.</p>
`

async function main() {
  const result = await runQualityGate(sampleArticle, {
    brand: 'seoranko',
    keyword: 'ev charger station',
    authorName: 'Kamran Gul',
    registeredLinkDomains: ['seoranko.com'],
    minWordCount: 10,
  })

  const falsePositive = result.issues.find(
    i => i.category === 'typo' && i.title === 'Duplicate word found' && /8px/i.test(i.location || '')
  )

  if (falsePositive) {
    console.error('FAIL: style="...8px 8px..." was flagged as a duplicate word:', falsePositive)
    process.exit(1)
  }

  console.log('PASS: style attribute with repeated "8px 8px" did not trigger a duplicate-word flag.')
  console.log(`Quality gate issues found: ${result.issues.length}`)
}

main()
