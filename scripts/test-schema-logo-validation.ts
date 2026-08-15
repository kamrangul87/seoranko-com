// Verifies schema-generator + validator agree on intentionally omitted logo.
// Usage: npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' scripts/test-schema-logo-validation.ts

import { generateArticleSchema } from '../src/lib/schema-generator'
import { validateSchema } from '../src/lib/schema-validator'
import { runQualityGate } from '../src/lib/article-quality-gate'

const sampleBody = `
  <h1>EV Charger Installation Guide</h1>
  <p>Written by Kamran Gul. Home EV charger installation is straightforward when planned properly.</p>
  <h2>What Permits Do You Need?</h2>
  <p>Most domestic installs in the UK fall under permitted development when done by a qualified electrician.</p>
  <h2>Frequently Asked Questions</h2>
  <div class="faq-item"><h3>How long does installation take?</h3><p>Typically half a day for a standard wallbox.</p></div>
`

function assertNoLogoWarnings(label: string, issues: { category?: string; title?: string; property?: string }[]) {
  const logoIssues = issues.filter(
    i =>
      (i.title && /logo/i.test(i.title)) ||
      (i as { property?: string }).property === 'logo' ||
      (i as { property?: string }).property === 'publisher.logo'
  )
  if (logoIssues.length > 0) {
    console.error(`FAIL [${label}]: unexpected logo warnings:`, logoIssues)
    process.exit(1)
  }
  console.log(`PASS [${label}]: no Organization/publisher logo warnings`)
}

async function main() {
  // Same inputs article-v2 uses when brand_settings.logo_url is unset.
  const schema = generateArticleSchema({
    title: 'EV Charger Installation Guide',
    description: 'How to install a home EV charger safely in the UK.',
    keyword: 'ev charger installation',
    authorName: 'Kamran Gul',
    publishDate: new Date().toISOString(),
    articleUrl: 'https://ev.autodun.com/ev-charger-installation',
    wordCount: 1200,
    organizationName: 'ev.autodun.com',
    organizationUrl: 'https://ev.autodun.com',
    // organizationLogoUrl intentionally omitted — matches real generation
  })

  const articleHtml = `${sampleBody}\n\n${schema.combinedScriptTag}`

  const strict = validateSchema(articleHtml, { expectOrganizationLogo: true })
  const aligned = validateSchema(articleHtml, { expectOrganizationLogo: false })

  const strictLogo = strict.issues.filter(i => i.property === 'logo' || i.property === 'publisher.logo')
  if (strictLogo.length === 0) {
    console.error('FAIL: strict validation should flag missing logo for control case')
    process.exit(1)
  }
  console.log(`PASS [strict control]: ${strictLogo.length} logo warning(s) as expected`)

  assertNoLogoWarnings('validator aligned', aligned.issues)

  const qg = await runQualityGate(articleHtml, {
    brand: 'ev.autodun.com',
    keyword: 'ev charger installation',
    authorName: 'Kamran Gul',
    registeredLinkDomains: [],
    minWordCount: 100,
    expectOrganizationLogo: false,
  })

  assertNoLogoWarnings('quality gate aligned', qg.issues.filter(i => i.category === 'schema'))

  console.log(`Quality gate score (no logo expected): ${qg.score}/100, warnings: ${qg.warningCount}`)
}

main()
