/**
 * Claim factuality classification — advisory/opinion vs verifiable fact.
 *
 * Quality Gate was treating advice like "the smarter financial choice is
 * right-sizing your EV charger now…" the same as "the grant covers 40%".
 * Only the latter needs a citation. Shared by claim-evidence and dated-policy
 * detectors so they cannot disagree.
 */

/** Hard verifiable markers: specific money, %, concrete dates, named-rule verbs. */
export const VERIFIABLE_FACT_MARKER_RE =
  /(?:[£$€]\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\b(?:must|required|requires|compulsory|mandatory|statutory|legislation|by law)\b|\b(?:eligib(?:le|ility)|deadline|threshold|cap)\b|\b(?:covers?|pays?|funds?|rebates?)\s+up\s+to\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}-\d{2}-\d{2}\b)/i

/**
 * Subjective / advisory phrasing — recommendations and judgment calls,
 * not assertions of a checkable figure or named rule.
 */
export const ADVISORY_OPINION_RE =
  /\b(?:the\s+smarter(?:\s+\w+)?\s+choice|smarter\s+to|better\s+to|best\s+to|worth\s+(?:doing|checking|considering|looking)|it(?:'s| is)\s+worth|consider\b|you\s+(?:should|might\s+want\s+to|may\s+want\s+to)|we\s+recommend|recommended(?:\s+approach)?|right-siz(?:e|ing)|in\s+my\s+(?:view|experience|opinion)|ideally\b|preferably\b|makes\s+sense\s+to|a\s+good\s+(?:idea|option)\s+to|rather\s+than\s+waiting)\b/i

/**
 * Soft policy-noun mentions that previously caused false positives when they
 * appeared inside advice ("waiting for the next grant scheme") without a
 * figure or hard rule assertion.
 */
export const SOFT_POLICY_NOUN_RE =
  /\b(grant|scheme|fund(?:ing)?|subsid(?:y|ies)|rebate|allowance|rate|tariff|threshold|cap|eligib|tax|duty|levy|standard|regulation|policy)\b/i

/**
 * True when the sentence asserts something a reader could verify against a
 * source (figure, date, or named rule), regardless of tone.
 */
export function hasVerifiableFactMarker(sentence: string): boolean {
  return VERIFIABLE_FACT_MARKER_RE.test(sentence)
}

/**
 * Advisory/subjective sentence with no verifiable number, date, or named-rule
 * assertion — exempt from citation / claim-evidence / dated-policy requirements.
 */
export function isAdvisoryOpinionSentence(sentence: string): boolean {
  if (!sentence || !ADVISORY_OPINION_RE.test(sentence)) return false
  if (hasVerifiableFactMarker(sentence)) return false
  return true
}

/**
 * Whether Quality Gate should require a citation for this sentence.
 * Advisory opinions without verifiable markers → false.
 * Specific £/%/date/named-rule assertions → true.
 * Soft policy nouns alone (grant/scheme/…) without a marker → false when
 * the sentence is advisory; otherwise true only with a verifiable marker
 * or a hard policy-assertion shape (must/required + policy noun).
 */
export function requiresCitation(sentence: string): boolean {
  if (isAdvisoryOpinionSentence(sentence)) return false
  if (hasVerifiableFactMarker(sentence)) return true
  // Hard policy assertion without a figure: "applicants must meet scheme rules"
  if (
    /\b(must|required|requires)\b/i.test(sentence) &&
    SOFT_POLICY_NOUN_RE.test(sentence)
  ) {
    return true
  }
  return false
}
