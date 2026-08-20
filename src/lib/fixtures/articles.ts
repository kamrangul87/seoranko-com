/**
 * Real-failure article fixtures for the permanent quality regression suite.
 *
 * These are distilled from prior SEORANKO production/script failures
 * (schema image/logo false positives, £350 grant claims, hedge density,
 * word-count advisories, gov.uk sentence-boundary bugs) — not synthetic toys.
 */

export const FIXTURE_HERO = 'https://cdn.example.com/fixtures/hero.webp'
export const FIXTURE_CONTENT = 'https://cdn.example.com/fixtures/content.webp'
export const FIXTURE_LOGO = 'https://example.com/brand-logo.png'
export const GOV_GRANT_URL =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'

/** A — Final HTML that already ships Article.image + Organization.logo (historical QG false-positive class). */
export const FIXTURE_SCHEMA_IMAGE_LOGO_PRESENT = `
<article>
<h1>Home EV charger installation guide</h1>
<p class="article-dateline"><em>Last updated: August 2026 · Fact-checked: August 2026</em></p>
<p>By Kamran Gul. Installing a home EV charger starts with confirming your supply capacity and choosing a unit that matches your vehicle's charge rate.</p>
<figure><img src="${FIXTURE_HERO}" alt="Wallbox on a brick wall" width="1200" height="630" /></figure>
<p>Next, book a qualified installer. After fitting, test the unit and register it with your network operator where required.</p>
<h2>Costs and permits</h2>
<p>Permit rules vary by location. Always check local guidance before work begins.</p>
</article>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"Home EV charger installation guide","author":{"@type":"Person","name":"Kamran Gul"},"datePublished":"2026-08-18","dateModified":"2026-08-18","image":["${FIXTURE_HERO}"],"publisher":{"@type":"Organization","name":"Example Brand","url":"https://example.com","logo":{"@type":"ImageObject","url":"${FIXTURE_LOGO}"}}}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Example Brand","url":"https://example.com","logo":{"@type":"ImageObject","url":"${FIXTURE_LOGO}"}}
</script>
`

/** E — Article schema missing image (control). */
export const FIXTURE_MISSING_IMAGE = `
<article>
<h1>Home EV charger installation guide</h1>
<p>By Kamran Gul. Installing a home EV charger needs a confirmed supply and a qualified installer.</p>
</article>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"Home EV charger installation guide","author":{"@type":"Person","name":"Kamran Gul"},"datePublished":"2026-08-18","publisher":{"@type":"Organization","name":"Example Brand","url":"https://example.com","logo":{"@type":"ImageObject","url":"${FIXTURE_LOGO}"}}}
</script>
`

/** F — Organization/publisher logo required but absent (control). */
export const FIXTURE_MISSING_LOGO = `
<article>
<h1>Home EV charger installation guide</h1>
<p>By Kamran Gul. Installing a home EV charger needs a confirmed supply and a qualified installer.</p>
<figure><img src="${FIXTURE_HERO}" alt="Wallbox" /></figure>
</article>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"Home EV charger installation guide","author":{"@type":"Person","name":"Kamran Gul"},"datePublished":"2026-08-18","image":["${FIXTURE_HERO}"],"publisher":{"@type":"Organization","name":"Example Brand","url":"https://example.com"}}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Example Brand","url":"https://example.com"}
</script>
`

/** C — Duplicate JSON-LD Article blocks (pre-dedupe failure class). */
export const FIXTURE_DUPLICATE_JSONLD = `
<article>
<h1>Home EV charger installation guide</h1>
<p>By Kamran Gul. Installing a home EV charger needs planning and a qualified electrician.</p>
</article>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Stale title","image":["https://cdn.example.com/stale.webp"]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Also stale","image":["https://cdn.example.com/stale2.webp"]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Wrong Org"}</script>
`

/**
 * B / grant — £350 grant claim fixture (from prior Quality Gate failures).
 * Includes article "Last updated" dateline that must NOT count as evidence.
 */
export const FIXTURE_GRANT_350 = `
<article>
<h1>Workplace EV charger grant UK</h1>
<p class="article-dateline"><em>Last updated: August 2026</em></p>
<p>Written by Kamran Gul of Example Brand.</p>
<p>The workplace charging grant is currently £350 toward hardware costs for eligible businesses.</p>
<p>Confirm figures on the
<a href="${GOV_GRANT_URL}">GOV.UK low-emission vehicle grants</a> collection before quoting customers.</p>
<p>Applications before 1 April 2024 could receive up to £350 under earlier rules — that cap is historical.</p>
<p>Check the rules now before you submit an application.</p>
</article>
`

/** M — Dated/current claim with no official source. */
export const FIXTURE_DATED_NO_SOURCE = `
<article>
<h1>EV charger grant rates</h1>
<p>By Kamran Gul.</p>
<p>The grant is currently £350 for eligible workplaces across the UK.</p>
</article>
`

/** L — Dated claim with official source link in context. */
export const FIXTURE_DATED_WITH_SOURCE = `
<article>
<h1>EV charger grant rates</h1>
<p>By Kamran Gul.</p>
<p>Eligible businesses can currently claim up to £500 towards chargepoint hardware under the workplace charging scheme.
Confirm the current amount on the
<a href="${GOV_GRANT_URL}">GOV.UK low-emission vehicle grants</a> collection.</p>
</article>
`

/** Q — Repetitive hedge language (typically density failure). */
export const FIXTURE_REPEATED_TYPICALLY = `
<article>
<h1>Home wallbox buying guide</h1>
<p>By Kamran Gul.</p>
<p>A home wallbox typically costs more than a portable unit. Installers typically recommend a dedicated circuit. Tariffs typically favour overnight charging. Warranties typically last three to five years. Load balancing typically matters on older consumer units. Planning permission typically is not required for a standard house wallbox. Lead times typically run one to two weeks. Smart features typically include app scheduling.</p>
</article>
`

/** R — Appropriate uncertainty (should not over-flag). */
export const FIXTURE_APPROPRIATE_UNCERTAINTY = `
<article>
<h1>Home wallbox buying guide</h1>
<p>By Kamran Gul.</p>
<p>Permit rules vary by location, so confirm local guidance before work begins. Where your supply capacity is unclear, ask a qualified electrician to assess it. Grant eligibility depends on parking and ownership rules published on GOV.UK.</p>
</article>
`

/** S — Below word-count target but topically complete (editorial advisory only). */
export const FIXTURE_BELOW_WORD_TARGET_COMPLETE = `
<article>
<h1>Home EV charger installation</h1>
<p>By Kamran Gul of Example Brand.</p>
<p>Installing a home EV charger starts with confirming supply capacity and choosing a wallbox that matches your vehicle's onboard charger rate.</p>
<p>Book a qualified installer, agree cable routes in writing, and register the unit with your network operator where local rules require notification.</p>
<h2>Costs and permits</h2>
<p>Hardware and labour quotes should be separated. Permit rules vary — check local guidance before ordering parts.</p>
<h2>Choosing a wallbox</h2>
<p>Match tethered versus socketed designs to how you park. Prefer scheduled charging and a clear parts-and-labour warranty.</p>
</article>
`

/** T — Short article missing topical coverage for the keyword. */
export const FIXTURE_SHORT_MISSING_COVERAGE = `
<article>
<h1>Hello</h1>
<p>By Kamran Gul.</p>
<p>This is a short note about weather and travel tips for the weekend.</p>
</article>
`

/**
 * J — Domain names in prose (gov.uk / energynetworks.org) must not count as
 * sentence boundaries or merge-artifact failures.
 */
export const FIXTURE_DOMAIN_GOV_UK = `
<article>
<h1>Notifying your network operator</h1>
<p>By Kamran Gul.</p>
<p>After installation, notify your DNO. Guidance is published at energynetworks.org. Skipping this step can delay energisation.</p>
<p>Further detail is on gov.uk for grant eligibility when you claim workplace funding.</p>
<p>See also ofgem.gov.uk for licence conditions that affect installers.</p>
</article>
`

/** K — Real dense paragraphs (6+ sentences each) — scannability still detects. */
export const FIXTURE_DENSE_PARAGRAPH = `
<article>
<h1>EV charger types comparison</h1>
<p>By Kamran Gul.</p>
<p>Level 1 charging uses a standard domestic socket. It is the slowest option for most modern EVs. Drivers use it when they lack a dedicated wallbox. Overnight top-ups can still help before a commute. Onboard charger limits cap the rate. DC rapid infrastructure is a different category entirely. Installers typically specify AC units for driveways instead.</p>
<p>Level 2 wallboxes need a dedicated circuit. Most UK homes choose seven kilowatt units. Smart scheduling reduces bill impact. Load balancing protects older consumer units. Warranties should cover parts and labour. Installer accreditation matters for insurance. Cable routing must be agreed before ordering hardware.</p>
<p>Workplace grants offset hardware costs. Eligibility depends on parking and ownership rules. Landlords must consent in writing. OZEV-approved installers are required. Quotes should separate labour from hardware. Confirm current rates on official guidance. Keep records for any claim audit.</p>
<p>Rapid DC hubs suit long journeys. Home overnight charging covers most weekly miles. Tariff timing changes running costs materially. Flat dwellers face different constraints. Shared driveways need neighbour agreement. Planning rules differ for listed buildings. Always verify local requirements before work starts.</p>
</article>
`

export const ARTICLE_FIXTURES = {
  schemaImageLogoPresent: FIXTURE_SCHEMA_IMAGE_LOGO_PRESENT,
  missingImage: FIXTURE_MISSING_IMAGE,
  missingLogo: FIXTURE_MISSING_LOGO,
  duplicateJsonLd: FIXTURE_DUPLICATE_JSONLD,
  grant350: FIXTURE_GRANT_350,
  datedNoSource: FIXTURE_DATED_NO_SOURCE,
  datedWithSource: FIXTURE_DATED_WITH_SOURCE,
  repeatedTypically: FIXTURE_REPEATED_TYPICALLY,
  appropriateUncertainty: FIXTURE_APPROPRIATE_UNCERTAINTY,
  belowWordTargetComplete: FIXTURE_BELOW_WORD_TARGET_COMPLETE,
  shortMissingCoverage: FIXTURE_SHORT_MISSING_COVERAGE,
  domainGovUk: FIXTURE_DOMAIN_GOV_UK,
  denseParagraph: FIXTURE_DENSE_PARAGRAPH,
} as const
