// Never surface third-party brand or domain names in user-facing UI.
// We analyse SERP/citation gaps internally; users see generic labels only.

const OFFICIAL_PATTERNS = [
  /\.gov(\.|$)/i,
  /\.gov\.uk/i,
  /\.edu/i,
  /\.ac\.uk/i,
  /nhs\.(uk|net)/i,
]

export function anonymizeDomain(domain: string | null | undefined): string {
  if (!domain?.trim()) return 'another source'

  const normalized = domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()

  if (!normalized) return 'another source'

  for (const pattern of OFFICIAL_PATTERNS) {
    if (pattern.test(normalized)) return 'an official source'
  }

  return 'another site'
}

/** Pick a single generic label for a list of cited/ranking domains. */
export function anonymizeCompetitorHint(domains: string[] | null | undefined): string {
  if (!domains?.length) return 'another source'
  return anonymizeDomain(domains[0])
}

/** User-facing copy for AI citation gap — no third-party names. */
export function citationGapLabel(cited: boolean, competitorDomains: string[]): string {
  if (cited) return 'Cited by AI'
  const hint = anonymizeCompetitorHint(competitorDomains)
  return `Not cited by AI — ${hint} cited instead`
}

/** Recommendation text without naming specific competitors. */
export function citationRecommendation(
  shareOfVoice: number,
  isCited: boolean,
  competitorCount: number
): string {
  if (shareOfVoice >= 67) {
    return 'Strong AI visibility — maintain content freshness and keep schema up to date'
  }
  if (shareOfVoice >= 33) {
    return 'Partial visibility — strengthen fact density, answer-first structure, and schema'
  }
  if (isCited) {
    return 'Occasional citation — improve answer-first structure and add more attributed statistics'
  }
  const gapHint =
    competitorCount > 1
      ? `${competitorCount} other sources are being cited for this topic`
      : 'Another source is being cited for this topic'
  return `Not currently cited — ${gapHint}. Prioritise schema injection, freshness refresh, and authority links.`
}
