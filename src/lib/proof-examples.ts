/**
 * Public proof examples — sourced only from
 * docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md (closed, production-verified).
 * No ranking, traffic, visibility, or impact claims.
 */

export type ProofExample = {
  /** One plain sentence: the problem found. */
  problem: string
  /** What changed in the site code. */
  whatChanged: string
  /** Customer-repo PR number (autodun-ai). */
  prNumber: number
  /** Production verify date from the outcome record (YYYY-MM-DD). */
  verifiedLiveOn: string
}

/** autodun.com closed production-verified outcomes in the ledger. */
export const PROOF_VERIFIED_FIX_COUNT = 14

export const PROOF_SITE_HOST = 'autodun.com'

/** Repo is public (unauthenticated GET returned 200) — safe to link PRs. */
export const PROOF_PR_BASE_URL = 'https://github.com/kamrangul87/autodun-ai/pull'

/**
 * Up to six representative closed outcomes for the homepage proof section.
 * Fields taken only from FIX_VERIFY_OUTCOME_RECORD.md.
 */
export const PROOF_EXAMPLES: ProofExample[] = [
  {
    problem: 'Content images on a blog page were missing width and height attributes.',
    whatChanged:
      'Set width="1200" height="675" on three content images from their JPEG headers.',
    prNumber: 34,
    verifiedLiveOn: '2026-09-22',
  },
  {
    problem: 'Declared image dimensions on a blog page did not match the files’ aspect ratio.',
    whatChanged:
      'Corrected declared dimensions from JPEG headers to 1024×1024 on three images.',
    prNumber: 36,
    verifiedLiveOn: '2026-09-22',
  },
  {
    problem: 'Conflicting preferred URL forms for /blog (canonical and internal links disagreed).',
    whatChanged:
      'Set canonical and og:url to https://autodun.com/blog and rewrote internal /blog/ and /blog/index.html links to /blog.',
    prNumber: 37,
    verifiedLiveOn: '2026-09-22',
  },
  {
    problem: 'autodun.com’s sitemap listed a URL on a different host (mot.autodun.com).',
    whatChanged: 'Removed the mot.autodun.com loc entry from the autodun.com sitemap.',
    prNumber: 38,
    verifiedLiveOn: '2026-09-22',
  },
  {
    problem: 'The /about page linked to /charging-map, which returned 404.',
    whatChanged: 'Rewrote the CTA href to https://ev.autodun.com/.',
    prNumber: 46,
    verifiedLiveOn: '2026-09-24',
  },
  {
    problem: 'The indexable /about page was missing from the site sitemap.',
    whatChanged: 'Added https://autodun.com/about to the hand-maintained sitemap.xml.',
    prNumber: 47,
    verifiedLiveOn: '2026-09-24',
  },
]
