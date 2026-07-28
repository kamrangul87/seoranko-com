// src/lib/content-identity-guard.ts
// Verifies an "edited" article is still recognisably the same document as the
// original it claims to be editing. Uses Jaccard similarity on word sets — the
// standard technique for content-drift detection.
//
// Call this BEFORE saving any edit; block the save if it fails.

export interface IdentityCheckResult {
  isSameDocument: boolean
  similarityScore: number   // 0-1, 1 = identical
  sharedTitleWords: number
  warning: string | null
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const aArr = Array.from(a)
  const intersection = aArr.filter(x => b.has(x)).length
  const union = new Set(aArr.concat(Array.from(b))).size
  return union === 0 ? 0 : intersection / union
}

// A genuine edit — even a heavy rewrite — should retain at least this much
// word overlap. Below it, the result is very likely an unrelated document.
export const MIN_SIMILARITY = 0.25
const HEAVY_REWRITE_THRESHOLD = 0.4

// Below this many tokens, Jaccard is too noisy to judge (a 40-word stub
// legitimately expanded to 1,200 words scores low without being "different").
const MIN_TOKENS_FOR_JUDGEMENT = 40

export function checkContentIdentity(
  originalContent: string,
  originalTitle: string | null,
  resultContent: string,
  resultTitle: string | null
): IdentityCheckResult {

  const origTokens = tokenize(originalContent)
  const resultTokens = tokenize(resultContent)
  const similarityScore = jaccardSimilarity(origTokens, resultTokens)

  const origTitleTokens = tokenize(originalTitle || '')
  const resultTitleTokens = tokenize(resultTitle || '')
  const sharedTitleWords = Array.from(origTitleTokens).filter(w => resultTitleTokens.has(w)).length

  // Too little source material to judge — don't block.
  if (origTokens.size < MIN_TOKENS_FOR_JUDGEMENT) {
    return {
      isSameDocument: true,
      similarityScore,
      sharedTitleWords,
      warning: null
    }
  }

  const isSameDocument = similarityScore >= MIN_SIMILARITY

  let warning: string | null = null
  if (!isSameDocument) {
    warning = `This result shares only ${Math.round(similarityScore * 100)}% of its content with the original article — it looks like a different document was generated instead of an edit. Save blocked.`
  } else if (similarityScore < HEAVY_REWRITE_THRESHOLD) {
    warning = `This is a heavy rewrite — only ${Math.round(similarityScore * 100)}% word overlap with the original. Review carefully before publishing.`
  }

  return { isSameDocument, similarityScore, sharedTitleWords, warning }
}
