/**
 * Public /about copy. Positioning source: docs/POSITIONING.md.
 * Do not name a holding/parent company. Do not mention visas.
 */

export const ABOUT_COPY = {
  title: 'About SEORANKO',
  metaDescription:
    'SEORANKO crawls small GitHub, Vercel, and Next.js sites, opens Fix Agent pull requests you approve, and reports Search Console and internal link-map detail. Built by Kamran.',
  lede:
    'SEORANKO finds technical problems that stop Google indexing a site properly, opens a fix as a GitHub pull request you approve, and re-checks the live page after it ships.',
  founderName: 'Kamran',
  founderLine:
    'SEORANKO is built by Kamran for operators of small sites who want the indexing basics done honestly.',
  whatTitle: 'What SEORANKO does',
  what: [
    {
      title: 'Crawl and audit',
      body: 'Crawls your site and checks it against sourced technical and indexing criteria. Each finding has a plain-English explanation, a why-not-fixed reason when it was left alone, and a source link.',
    },
    {
      title: 'Fix Agent pull requests',
      body: 'On GitHub-connected sites, Fix Agent opens a pull request with the change. You review and approve it. Nothing is merged or deployed without that approval.',
    },
    {
      title: 'Search Console reports',
      body: 'Weekly Search Console summaries in the product show what Google reported for your connected property — impressions, clicks, and which URLs appeared.',
    },
    {
      title: 'Internal link map',
      body: 'The link map shows internal links as they are crawled, so you can see orphans, dead ends, and how pages connect.',
    },
  ],
  whoTitle: 'Who it is for',
  who: 'Small sites on GitHub, Vercel, and Next.js. WordPress, Shopify, and Wix sites can use the audit; automated fixes need a GitHub-connected repo.',
  approachTitle: 'How we work',
  approach:
    "White-hat, guideline-led work: we follow Google's published Search Essentials and spam policies, refuse machine-guessed quality scores, and keep a human in the loop on every write to your site.",
} as const

export function collectAboutCopyStrings(): string[] {
  const out: string[] = [
    ABOUT_COPY.title,
    ABOUT_COPY.metaDescription,
    ABOUT_COPY.lede,
    ABOUT_COPY.founderName,
    ABOUT_COPY.founderLine,
    ABOUT_COPY.whatTitle,
    ABOUT_COPY.whoTitle,
    ABOUT_COPY.who,
    ABOUT_COPY.approachTitle,
    ABOUT_COPY.approach,
  ]
  for (const item of ABOUT_COPY.what) {
    out.push(item.title, item.body)
  }
  return out
}
