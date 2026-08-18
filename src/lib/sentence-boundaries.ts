/**
 * Shared sentence-boundary helpers for scannability / paragraph splitting.
 *
 * Domain-like tokens (gov.uk, energynetworks.org) must be masked before
 * counting or splitting on "." — otherwise TLDs inflate sentence counts.
 *
 * Phase 0 creates the module; Phase 3 wires it into structure-validator
 * scannability counting. paragraph-splitter may re-export from here later.
 */

const DOMAIN_TOKEN_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi

/** Length-preserving mask so offsets stay aligned with the original string. */
export function maskDomainLikeTokens(text: string): string {
  return text.replace(DOMAIN_TOKEN_RE, (m) => 'x'.repeat(m.length))
}

/**
 * Count sentences in plain text after masking domain-like tokens.
 * Uses terminal punctuation runs that typically end a sentence.
 */
export function countSentences(text: string): number {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return 0
  const masked = maskDomainLikeTokens(plain)
  const matches = masked.match(/[.!?]+/g)
  return matches ? matches.length : 0
}

/**
 * End offsets (in the original string) of sentence-ending punctuation,
 * after domain masking. Does not include the final string length.
 */
export function sentenceBoundaryOffsets(text: string): number[] {
  const masked = maskDomainLikeTokens(text)
  const boundaries: number[] = []
  const re = /[.!?]+(?=\s+[A-Z"'‘“<])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    boundaries.push(m.index + m[0].length)
  }
  return boundaries
}
