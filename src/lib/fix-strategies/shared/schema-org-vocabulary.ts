/**
 * schema.org vocabulary snapshot for topic 37.
 *
 * Snapshot is dated. Types NOT in this snapshot that look like well-formed
 * schema.org names are NOT flagged as invalid (extension / pending / newer
 * release) — same error class as a hardcoded language list (topic 34).
 *
 * Only clear misspellings (near edit-distance to a known type) and empty /
 * malformed @type values are raised as invalid.
 *
 * Snapshot version recorded so staleness is visible (guard 7).
 */

export const SCHEMA_ORG_VOCAB_SNAPSHOT = {
  version: 'schema.org-core-2026-09-15',
  snapshotDate: '2026-09-15',
} as const

/** type → parent types (for property inheritance). */
export const SCHEMA_ORG_TYPE_PARENTS: Record<string, readonly string[]> = {
  Thing: [],
  CreativeWork: ['Thing'],
  Article: ['CreativeWork'],
  NewsArticle: ['Article'],
  BlogPosting: ['Article'],
  WebPage: ['CreativeWork'],
  FAQPage: ['WebPage'],
  HowTo: ['CreativeWork'],
  HowToStep: ['CreativeWork', 'ListItem'],
  HowToDirection: ['CreativeWork', 'HowToStep'],
  HowToTip: ['CreativeWork', 'HowToStep'],
  Course: ['CreativeWork'],
  Book: ['CreativeWork'],
  Review: ['CreativeWork'],
  Person: ['Thing'],
  Organization: ['Thing'],
  ImageObject: ['MediaObject', 'CreativeWork'],
  MediaObject: ['CreativeWork'],
  ListItem: ['Intangible'],
  Intangible: ['Thing'],
  Question: ['CreativeWork'],
  Answer: ['Comment', 'CreativeWork'],
  Comment: ['CreativeWork'],
  BreadcrumbList: ['ItemList', 'Intangible'],
  ItemList: ['Intangible'],
  Product: ['Thing'],
  Offer: ['Intangible'],
  Event: ['Thing'],
  Place: ['Thing'],
  LocalBusiness: ['Place', 'Organization'],
  VideoObject: ['MediaObject'],
  WebSite: ['CreativeWork'],
  SearchAction: ['Action'],
  Action: ['Thing'],
  SpeakableSpecification: ['Intangible'],
}

/** Properties commonly valid on each type (plus inherited from parents). */
export const SCHEMA_ORG_TYPE_PROPERTIES: Record<string, readonly string[]> = {
  Thing: [
    'name',
    'url',
    'image',
    'description',
    'sameAs',
    'identifier',
    'mainEntityOfPage',
    'potentialAction',
    'additionalType',
    'alternateName',
  ],
  CreativeWork: [
    'author',
    'publisher',
    'datePublished',
    'dateModified',
    'headline',
    'inLanguage',
    'isPartOf',
    'keywords',
    'about',
    'citation',
    'copyrightHolder',
    'copyrightYear',
    'genre',
    'thumbnailUrl',
    'video',
    'audio',
    'text',
    'wordCount',
    'articleBody',
    'articleSection',
  ],
  Article: [],
  NewsArticle: ['dateline', 'printColumn', 'printEdition', 'printPage', 'printSection'],
  BlogPosting: [],
  WebPage: ['breadcrumb', 'mainEntity', 'primaryImageOfPage', 'speakable'],
  FAQPage: ['mainEntity'],
  HowTo: ['step', 'totalTime', 'estimatedCost', 'supply', 'tool', 'yield'],
  HowToStep: ['position', 'itemListElement', 'text', 'image', 'url', 'name'],
  Course: ['provider', 'courseCode', 'hasCourseInstance'],
  Book: ['isbn', 'numberOfPages', 'bookFormat', 'inLanguage', 'author'],
  Person: [
    'givenName',
    'familyName',
    'jobTitle',
    'honorificPrefix',
    'honorificSuffix',
    'worksFor',
    'affiliation',
    'email',
    'telephone',
    'address',
  ],
  Organization: ['logo', 'address', 'email', 'telephone', 'contactPoint', 'founder', 'foundingDate'],
  ImageObject: ['contentUrl', 'width', 'height', 'caption', 'encodingFormat'],
  Question: ['acceptedAnswer', 'suggestedAnswer', 'answerCount', 'upvoteCount', 'name', 'text'],
  Answer: ['text', 'upvoteCount', 'dateCreated', 'author'],
  BreadcrumbList: ['itemListElement'],
  ItemList: ['itemListElement', 'numberOfItems', 'itemListOrder'],
  ListItem: ['position', 'item', 'name', 'url'],
  Product: ['brand', 'sku', 'offers', 'aggregateRating', 'review', 'gtin', 'mpn'],
  Offer: ['price', 'priceCurrency', 'availability', 'url', 'seller', 'priceValidUntil'],
  Event: ['startDate', 'endDate', 'location', 'organizer', 'performer', 'eventStatus', 'offers'],
  Place: ['address', 'geo', 'telephone'],
  LocalBusiness: ['openingHours', 'priceRange', 'servesCuisine'],
  VideoObject: ['uploadDate', 'duration', 'contentUrl', 'embedUrl', 'thumbnailUrl'],
  WebSite: ['publisher', 'potentialAction'],
  SearchAction: ['target', 'query-input'],
  Action: ['target', 'agent', 'object', 'result'],
  SpeakableSpecification: ['cssSelector', 'xpath'],
  MediaObject: ['contentUrl', 'encodingFormat', 'bitrate', 'duration'],
  Intangible: [],
  Comment: ['parentItem'],
  Review: ['itemReviewed', 'reviewRating', 'reviewBody'],
}

const KNOWN_TYPES = new Set(Object.keys(SCHEMA_ORG_TYPE_PARENTS))

export function isKnownSchemaOrgType(typeName: string): boolean {
  const t = stripSchemaPrefix(typeName)
  return KNOWN_TYPES.has(t)
}

export function stripSchemaPrefix(typeName: string): string {
  return typeName.replace(/^https?:\/\/schema\.org\//i, '').trim()
}

/** Collect own + inherited properties for a type. */
export function propertiesForType(typeName: string): Set<string> {
  const out = new Set<string>()
  const visited = new Set<string>()
  const walk = (t: string) => {
    const name = stripSchemaPrefix(t)
    if (visited.has(name)) return
    visited.add(name)
    for (const p of SCHEMA_ORG_TYPE_PROPERTIES[name] ?? []) out.add(p)
    for (const parent of SCHEMA_ORG_TYPE_PARENTS[name] ?? []) walk(parent)
  }
  walk(typeName)
  return out
}

/**
 * Is `prop` valid on `typeName` (including inheritance)?
 * Unknown types → indeterminate (do not raise).
 */
export function isPropertyValidForType(
  typeName: string,
  prop: string,
): 'valid' | 'invalid' | 'indeterminate' {
  const t = stripSchemaPrefix(typeName)
  if (!KNOWN_TYPES.has(t)) return 'indeterminate'
  if (prop.startsWith('@')) return 'valid'
  const props = propertiesForType(t)
  // Nested paths like author.name — check top-level segment against type,
  // nested validity is contextual.
  const top = prop.split('.')[0]!
  if (props.has(top) || props.has(prop)) return 'valid'
  return 'invalid'
}

/** Levenshtein distance (small strings). */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  )
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      )
    }
  }
  return dp[m]![n]!
}

/**
 * Suggest unambiguous @type spelling correction.
 * Returns null when unknown-but-well-formed (do not raise) or ambiguous.
 */
export function suggestTypeSpelling(typeName: string): string | null {
  const t = stripSchemaPrefix(typeName)
  if (!t) return null
  if (KNOWN_TYPES.has(t)) return null

  // Case-only difference
  for (const known of KNOWN_TYPES) {
    if (known.toLowerCase() === t.toLowerCase()) return known
  }

  // Near miss: edit distance 1–2 against known types of similar length
  const candidates: Array<{ name: string; d: number }> = []
  for (const known of KNOWN_TYPES) {
    if (Math.abs(known.length - t.length) > 2) continue
    const d = editDistance(t.toLowerCase(), known.toLowerCase())
    if (d >= 1 && d <= 2) candidates.push({ name: known, d })
  }
  candidates.sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
  if (candidates.length === 1) return candidates[0]!.name
  if (
    candidates.length >= 2 &&
    candidates[0]!.d < candidates[1]!.d
  ) {
    return candidates[0]!.name
  }
  // Well-formed PascalCase unknown (e.g. Course, or a new type) → not a misspelling
  if (/^[A-Z][A-Za-z0-9]+$/.test(t)) return null
  return null
}

/**
 * Classify @type validity.
 * - known → valid
 * - unambiguous misspelling → invalid-misspelling
 * - well-formed unknown → valid-unknown (NEVER raise — may be extension)
 * - empty / garbage → invalid
 */
export function classifyTypeName(
  typeName: string,
):
  | { kind: 'valid'; name: string }
  | { kind: 'valid-unknown'; name: string }
  | { kind: 'invalid-misspelling'; name: string; suggestion: string }
  | { kind: 'invalid'; name: string } {
  const t = stripSchemaPrefix(typeName)
  if (!t) return { kind: 'invalid', name: typeName }
  if (KNOWN_TYPES.has(t)) return { kind: 'valid', name: t }
  const suggestion = suggestTypeSpelling(t)
  if (suggestion) {
    return { kind: 'invalid-misspelling', name: t, suggestion }
  }
  if (/^[A-Z][A-Za-z0-9]+$/.test(t)) {
    return { kind: 'valid-unknown', name: t }
  }
  return { kind: 'invalid', name: t }
}
