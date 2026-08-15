// Regression: screenshot Quality Gate failures (missing-brand, dated-policy, scannability)
// Usage: npx tsx scripts/test-qg-regression-ev-charger.ts

import { detectDatedClaims } from '../src/lib/dated-claim-detector'
import { autoSplitDenseParagraphs } from '../src/lib/scannability-fixer'
import { validateArticleStructure } from '../src/lib/structure-validator'
import { runQualityGate } from '../src/lib/article-quality-gate'
import { generateArticleSchema } from '../src/lib/schema-generator'

const now = new Date('2026-08-15T00:00:00Z')

const prose = `
<h1>EV Charger Installation Guide</h1>
<p class="article-byline">Written by <strong>Kamran Gul</strong>, Founder of Autodun.</p>
<p>The Office for Zero Emission Vehicles (OZEV) administers the Electric Vehicle Chargepoint Grant (EVCG), introduced in April 2022. This scheme helps renters and flat owners offset installation costs. The grant replaced earlier programmes and remains the primary UK subsidy for home chargepoints. OZEV publishes eligibility criteria on GOV.UK. Landlords must consent before installation proceeds. The grant does not cover the full hardware price. Installers must be OZEV-approved to qualify.</p>
<p>As of August 2026, the grant is available to renters and flat owners, according to GOV.UK's official EV chargepoint grant pages. Outright homeowners with private driveways typically fund installation themselves. The subsidy focuses on households without dedicated off-street parking. Check current rates before quoting a customer. Eligibility rules change with each fiscal review. OZEV updates guidance when policy shifts.</p>
<p>Choosing a 7kW charger suits most UK homes. A dedicated circuit is usually required. Smart chargers qualify for the grant when OZEV-approved. Installation takes half a day for a standard wallbox. Always verify cable routes with a qualified electrician. Load management may be needed on older consumer units. Tariff timing affects running costs materially. Warranty terms vary by manufacturer and installer.</p>
`

async function main() {
  // 1. Dated claims from screenshot sentences
  const claims = detectDatedClaims(prose, now)
  const unsourced = claims.filter(c => !c.hasSource)
  if (unsourced.length > 0) {
    console.error('FAIL dated-claims:', unsourced)
    process.exit(1)
  }
  console.log('PASS: no false-positive dated-policy claims')

  // 2. Scannability after iterative split
  const split = autoSplitDenseParagraphs(prose)
  const structure = validateArticleStructure(split)
  const scannability = structure.filter(s => s.category === 'scannability')
  if (scannability.length > 0) {
    console.error('FAIL scannability after split:', scannability)
    process.exit(1)
  }
  console.log('PASS: scannability clear after auto-split')

  // 3. Quality gate with brand set (no missing-brand critical)
  const schema = generateArticleSchema({
    title: 'EV Charger Installation Guide',
    description: 'Guide to EV charger grants and installation in the UK.',
    keyword: 'ev charger',
    authorName: 'Kamran Gul',
    publishDate: now.toISOString(),
    articleUrl: 'https://autodun.com/ev-charger',
    wordCount: 1200,
    organizationName: 'autodun',
    organizationUrl: 'https://autodun.com',
  })
  const html = `${split}\n\n${schema.combinedScriptTag}`

  const qg = await runQualityGate(html, {
    brand: 'autodun',
    keyword: 'ev charger',
    authorName: 'Kamran Gul',
    registeredLinkDomains: ['autodun.com'],
    minWordCount: 100,
    expectOrganizationLogo: false,
  })

  if (qg.criticalCount > 0) {
    console.error('FAIL quality gate criticals:', qg.issues.filter(i => i.severity === 'critical'))
    process.exit(1)
  }
  if (!qg.readyToPublish && qg.warningCount > 2) {
    console.error('FAIL not ready to publish:', qg.warningCount, 'warnings', qg.issues)
    process.exit(1)
  }

  console.log(`PASS: Quality Gate score=${qg.score}/100, readyToPublish=${qg.readyToPublish}`)
}

main()
