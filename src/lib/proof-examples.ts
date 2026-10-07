/**
 * Public proof examples — sourced only from
 * docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md (closed, production-verified).
 * No ranking, traffic, visibility, or impact claims.
 */

export type ProofAppliedBy = 'fix-agent' | 'approved-pr'

export type ProofExample = {
  /** One plain sentence: the problem found. */
  problem: string
  /** What changed in the site code. */
  whatChanged: string
  /** Customer-repo PR number (autodun-ai). */
  prNumber: number
  /** Production verify date from the outcome record (YYYY-MM-DD). */
  verifiedLiveOn: string
  /** Live URL that was re-fetched for verification (when known from the ledger). */
  verifiedUrl?: string
  /**
   * How the fix landed on the customer site (from FIX_VERIFY_OUTCOME_RECORD.md).
   * `fix-agent` = product commit path (topic 49, autodun-ai PR #34);
   * `approved-pr` = owner-approved customer PR.
   */
  appliedBy: ProofAppliedBy
}

/** autodun.com closed production-verified outcomes in the ledger. */
export const PROOF_VERIFIED_FIX_COUNT = 14

export const PROOF_SITE_HOST = 'autodun.com'

/**
 * Homepage proof section — indexing-related fixes first, image-dimension fixes last.
 * Fields taken only from FIX_VERIFY_OUTCOME_RECORD.md.
 */
export const PROOF_EXAMPLES: ProofExample[] = [
  {
    problem: 'Conflicting preferred URL forms for /blog (canonical and internal links disagreed).',
    whatChanged:
      'Set canonical and og:url to https://autodun.com/blog and rewrote internal /blog/ and /blog/index.html links to /blog.',
    prNumber: 37,
    verifiedLiveOn: '2026-09-22',
    verifiedUrl: 'https://autodun.com/blog',
    appliedBy: 'approved-pr',
  },
  {
    problem: 'autodun.com’s sitemap listed a URL on a different host (mot.autodun.com).',
    whatChanged: 'Removed the mot.autodun.com loc entry from the autodun.com sitemap.',
    prNumber: 38,
    verifiedLiveOn: '2026-09-22',
    verifiedUrl: 'https://autodun.com/sitemap.xml',
    appliedBy: 'approved-pr',
  },
  {
    problem: 'The /about page linked to /charging-map, which returned 404.',
    whatChanged: 'Rewrote the CTA href to https://ev.autodun.com/.',
    prNumber: 46,
    verifiedLiveOn: '2026-09-24',
    verifiedUrl: 'https://autodun.com/about',
    appliedBy: 'approved-pr',
  },
  {
    problem: 'The indexable /about page was missing from the site sitemap.',
    whatChanged: 'Added https://autodun.com/about to the hand-maintained sitemap.xml.',
    prNumber: 47,
    verifiedLiveOn: '2026-09-24',
    verifiedUrl: 'https://autodun.com/sitemap.xml',
    appliedBy: 'approved-pr',
  },
  {
    problem: 'Content images on a blog page were missing width and height attributes.',
    whatChanged:
      'Set width="1200" height="675" on three content images from their JPEG headers.',
    prNumber: 34,
    verifiedLiveOn: '2026-09-22',
    verifiedUrl: 'https://autodun.com/blog/mot-advisories-explained-uk.html',
    appliedBy: 'fix-agent',
  },
  {
    problem: 'Declared image dimensions on a blog page did not match the files’ aspect ratio.',
    whatChanged:
      'Corrected declared dimensions from JPEG headers to 1024×1024 on three images.',
    prNumber: 36,
    verifiedLiveOn: '2026-09-22',
    verifiedUrl: 'https://autodun.com/blog/mot-changes-2026-dvsa-updates.html',
    appliedBy: 'approved-pr',
  },
]

/** Hero loop card — the /blog canonical fix (PR #37). */
export const HERO_LOOP_EXAMPLE: ProofExample = PROOF_EXAMPLES[0]

/** Format YYYY-MM-DD as "22 Sep 2026". */
export function formatProofDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (!y || !m || !d || m < 1 || m > 12) return isoDate
  return `${d} ${months[m - 1]} ${y}`
}

export const PROOF_UI_COPY = {
  verifiedLivePill: 'Verified live',
  fixMergedLabel: 'merged',
  loopFindingLabel: 'Finding',
  loopFixLabel: 'Fix',
  loopVerifiedLabel: 'Verified',
  tableProblem: 'Problem found',
  tableChange: 'Change made',
  tableVerified: 'Verified live',
  viewLivePage: 'View live page',
  proofNothingMore:
    'Problems SEORANKO found on autodun.com, each fixed by pull request and re-checked on the live site.',
  appliedByFixAgent: 'Applied by Fix Agent',
  appliedByApprovedPr: 'Applied by approved pull request',
} as const

export function proofAppliedByLabel(appliedBy: ProofAppliedBy): string {
  return appliedBy === 'fix-agent'
    ? PROOF_UI_COPY.appliedByFixAgent
    : PROOF_UI_COPY.appliedByApprovedPr
}
