/**
 * Claim-discipline word list — docs/POSITIONING.md is the source for why.
 * SEORANKO observes and fixes technical/indexing problems; it never claims
 * or predicts an effect on ranking, traffic, position, visibility, or
 * penalty avoidance. One place, checked everywhere user-facing copy is
 * tested — see owner-copy.test.ts for the findings-verdict + homepage
 * checks that import this.
 */
export const BANNED_CLAIM_WORDS_RE =
  /\b(rank|ranks|ranking|rankings|ranked|traffic|position|positions|visibility|penalty|penalties)\b|\bgoogle will\b/i
