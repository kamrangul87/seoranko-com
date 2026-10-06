// Positioning source: docs/POSITIONING.md. Every string here is what a
// visitor actually reads — kept in one place, separate from src/app/page.tsx
// (Next's page-file export whitelist won't allow an extra named export
// there), so owner-copy.test.ts can scan it for banned claim words
// (src/lib/copy-rules.ts) without also scanning that file's CSS (which
// legitimately uses words like "position").
export const HOMEPAGE_COPY = {
  badge: 'Proving every fix is actually live',
  heroTitle: "Google can't index what's broken. We find it, fix it, and prove it's live.",
  heroSubtitle:
    'SEORANKO crawls your site, explains each technical or indexing problem in plain English, fixes what it can directly in your code, and re-checks the live page to confirm the fix actually shipped.',
  heroCtaPrimary: 'Start for free →',
  heroCtaSecondary: 'Free index check',
  heroFootnote: 'No credit card required · Free detect-only audits',
  proofEyebrow: 'Proof',
  proofTitle: 'Real fixes, verified on a live site',
  trustBar: [
    'Fixes commit via pull request',
    'Every fix re-verified on the live site',
    'Works with GitHub-connected sites',
    'Audit-only for WordPress, Shopify & Wix',
  ],
  featuresEyebrow: "What's inside",
  featuresTitle: 'Audit, fix, and prove it',
  featuresSubtitle: 'No spreadsheet, no manual re-checking. SEORANKO runs the whole loop.',
  features: [
    {
      icon: '🔍',
      title: 'Site crawl & audit',
      desc: 'Crawls your site and checks it against sourced technical and indexing criteria — not guesses.',
    },
    {
      icon: '📋',
      title: 'Plain-English findings',
      desc: "Each finding gets one sentence anyone can read, a reason if it wasn't auto-fixed, and a link to the source.",
    },
    {
      icon: '🛠️',
      title: 'Agentic fix, in your code',
      desc: 'For GitHub-connected sites, SEORANKO commits a deterministic fix and opens a pull request.',
    },
    {
      icon: '✅',
      title: 'Live verification',
      desc: 'After a fix deploys, SEORANKO re-fetches the real page and confirms the change actually shipped.',
    },
    {
      icon: '🔁',
      title: 'Weekly change monitoring',
      desc: 'A weekly re-crawl reports exactly what changed since last time — new findings, resolved ones, and any regressions.',
    },
    {
      icon: '🚫',
      title: "What we won't guess at",
      desc: "No invented E-E-A-T score, no keyword-cannibalisation verdicts. Where Google says a check isn't machine-checkable, we say so instead of pretending.",
    },
  ],
  howItWorksEyebrow: 'Workflow',
  howItWorksTitle: 'How SEORANKO works',
  howItWorksSteps: [
    { num: '01', title: 'Crawl & find', desc: 'SEORANKO crawls your site and checks it against sourced technical and indexing criteria.' },
    {
      num: '02',
      title: 'Read the finding',
      desc: "Each finding has a plain-English explanation, a why-not-fixed reason if it wasn't auto-fixable, and a source link.",
    },
    {
      num: '03',
      title: 'Fix in your code',
      desc: 'Approve a fix and SEORANKO commits it via pull request on GitHub-connected sites. WordPress, Shopify, and Wix sites get the audit only.',
    },
    {
      num: '04',
      title: "Prove it's live",
      desc: 'SEORANKO re-fetches the real deployed page and confirms the fix actually shipped — not just that the pull request merged.',
    },
  ],
  pricingEyebrow: 'Pricing',
  pricingTitle: 'Simple, honest pricing',
  pricingSubtitle: 'Site audit and agentic fix. Cancel anytime.',
  ctaTitle: "Stop guessing what's broken.",
  ctaSubtitle:
    "Free detect-only audits. See exactly what's stopping Google from indexing your site properly — then fix it in your code, or just look.",
  ctaButton: 'Get started free →',
}
