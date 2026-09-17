/**
 * Topic 39 — maintained rich-result deprecation table.
 *
 * Every entry MUST carry verifiedOn. An undated entry must not drive a finding.
 * Deprecated markup is INERT, not penalised (D28, D29). Informational only.
 *
 * Source: docs/fix-strategies/_structured_data_deprecation_table.md
 */

export type DeprecationEntry = {
  type: string
  /** Human-readable withdrawal summary. */
  withdrawn: string
  sourceUrl: string
  /** ISO date YYYY-MM-DD — required to raise. */
  verifiedOn: string
  notes?: string
}

export const STRUCTURED_DATA_DEPRECATION_TABLE: readonly DeprecationEntry[] = [
  {
    type: 'HowTo',
    withdrawn: 'September 2023 (mobile and desktop)',
    sourceUrl:
      'https://developers.google.com/search/blog/2023/08/howto-faq-changes',
    verifiedOn: '2026-09-15',
    notes:
      'Documentation, Rich Results Test support and Search Console reporting removed. schema.org markup may remain for other consumers.',
  },
  {
    type: 'FAQPage',
    withdrawn:
      '7 May 2026 (full withdrawal, including former gov/health exception); docs removed June 2026',
    sourceUrl:
      'https://developers.google.com/search/docs/appearance/structured-data/',
    verifiedOn: '2026-09-15',
    notes:
      'Confirm against Google documentation-updates feed on each maintenance pass.',
  },
] as const

/** Only dated entries can support a finding. */
export function lookupDeprecation(typeName: string): DeprecationEntry | null {
  const want = typeName.replace(/^https?:\/\/schema\.org\//i, '')
  for (const row of STRUCTURED_DATA_DEPRECATION_TABLE) {
    if (!row.verifiedOn) continue
    if (row.type.toLowerCase() === want.toLowerCase()) return row
  }
  return null
}
