/**
 * Topic 35 — maintained Search-feature requirement table.
 *
 * Every entry MUST carry verifiedOn. An undated entry cannot support a finding.
 * A type absent from this table produces NO finding (unknown ≠ non-compliant).
 *
 * Source of truth for humans: docs/fix-strategies/_structured_data_requirement_table.md
 */

export type RequirementProperty =
  | string
  | { path: string; notes?: string }

export type FeatureRequirementEntry = {
  /** schema.org @type names this row covers. */
  types: readonly string[]
  featurePageUrl: string
  required: readonly string[]
  recommended: readonly string[]
  /** ISO date YYYY-MM-DD — required. */
  verifiedOn: string
  notes?: string
  /**
   * Image guidance when `image` is recommended/required (D10).
   * Minimum width×height product — NOT a width-only or 800k figure.
   */
  imageMinPixels?: number
}

/**
 * Product-maintained table. Re-verify when Google's feature page last-updated
 * is later than verifiedOn.
 */
export const STRUCTURED_DATA_REQUIREMENT_TABLE: readonly FeatureRequirementEntry[] =
  [
    {
      types: ['Article', 'NewsArticle', 'BlogPosting'],
      featurePageUrl:
        'https://developers.google.com/search/docs/appearance/structured-data/article',
      // D7 — Google: "There are no required properties"
      required: [],
      recommended: [
        'author',
        'author.name',
        'author.url',
        'dateModified',
        'datePublished',
        'headline',
        'image',
      ],
      verifiedOn: '2026-09-15',
      notes:
        'Feature page last updated 2026-09-08. image is recommended, not required. Stale 1200px / 800000-pixel thresholds NOT adopted.',
      imageMinPixels: 50_000,
    },
    {
      types: ['BreadcrumbList'],
      featurePageUrl:
        'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
      required: ['itemListElement'],
      recommended: [],
      verifiedOn: '2026-09-15',
      notes: 'itemListElement is required for Breadcrumb rich results.',
    },
  ] as const

/** Look up a requirement row by @type. Null → no finding for topic 35. */
export function lookupRequirement(
  typeName: string,
): FeatureRequirementEntry | null {
  const want = typeName.replace(/^https?:\/\/schema\.org\//i, '')
  for (const row of STRUCTURED_DATA_REQUIREMENT_TABLE) {
    if (!row.verifiedOn) continue // undated → unusable
    if (row.types.some((t) => t.toLowerCase() === want.toLowerCase())) {
      return row
    }
  }
  return null
}

/** Current Article image minimum (width × height). Never use 1200 / 800000. */
export const ARTICLE_IMAGE_MIN_PIXELS = 50_000
