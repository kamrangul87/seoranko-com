/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/schema-validator.ts
// Validates JSON-LD against schema.org required/recommended properties for the
// types SEORANKO generates. Runs in-pipeline before save rather than being
// discovered later by an external audit tool.
//
// Phase E (Real Publishing & Verification): this is Tier 1 only — a LOCAL
// structural check against schema.org/Google's documented requirements,
// not a live verdict from Google. There is no public Rich Results Test
// API to build toward; this module can never itself say "Google-confirmed
// eligible" and no UI reading its output should claim that either — the
// correct framing is TIER_1_LABEL below. A genuine Tier 2 ("Google-
// detected") requires GSC's URL Inspection API richResultsResult, wired
// once a real article reaches LIVE_VERIFIED and a GSC OAuth connection
// exists (both blocked on infrastructure this environment doesn't have
// yet) — see Phase C. Also worth surfacing wherever FAQ schema results are
// shown: Google now grants FAQ rich results mostly to authoritative
// government/health sites for most queries, so "meets requirements" here
// is not a promise of eligibility even once Tier 2 exists.
export const TIER_1_LABEL = 'Schema-valid — meets known rich-result requirements'
export const TIER_1_DISCLAIMER = 'This is a local structural check against documented requirements, not a live verdict from Google. It does not mean Google has confirmed this page is rich-result eligible.'

export interface SchemaIssue {
  schemaType: string
  severity: 'error' | 'warning'
  property: string
  message: string
}

export interface SchemaValidationResult {
  valid: boolean
  schemasFound: string[]
  issues: SchemaIssue[]
  richResultEligible: Record<string, boolean>
}

const SCHEMA_RULES: Record<string, { required: string[]; recommended: string[] }> = {
  Article:        { required: ['headline', 'author', 'datePublished'], recommended: ['image', 'publisher', 'dateModified', 'inLanguage'] },
  BlogPosting:    { required: ['headline', 'author', 'datePublished'], recommended: ['image', 'publisher', 'dateModified'] },
  Person:         { required: ['name'],                                recommended: ['jobTitle', 'worksFor', 'url'] },
  Organization:   { required: ['name'],                                recommended: ['url', 'logo', 'sameAs'] },
  FAQPage:        { required: ['mainEntity'],                          recommended: [] },
  Question:       { required: ['name', 'acceptedAnswer'],              recommended: [] },
  BreadcrumbList: { required: ['itemListElement'],                     recommended: [] },
  HowTo:          { required: ['name', 'step'],                        recommended: ['totalTime', 'image'] },
}

function extractJsonLdBlocks(html: string): any[] {
  const blocks: any[] = []
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      // A single script tag may hold an array of blocks, or an @graph wrapper.
      if (Array.isArray(parsed)) blocks.push(...parsed)
      else if (Array.isArray(parsed['@graph'])) blocks.push(...parsed['@graph'])
      else blocks.push(parsed)
    } catch {
      blocks.push({ __parseError: true, raw: match[1].slice(0, 100) })
    }
  }
  return blocks
}

function isPlausibleUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\/\S+/i.test(value)
}

function isValidDateString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && !isNaN(Date.parse(value))
}

// Existing checks above only confirm a property EXISTS, not that its value
// is actually shaped the way Google's structured data guidelines expect.
// Confirmed via schema-generator.ts's own output that this gap is real, not
// hypothetical: publisher is generated as { "@type": "Organization", name,
// url } with no logo at all — Google's Article guidelines list
// publisher.logo as a recommended property for full rich-result
// eligibility, and nothing before this validated publisher's shape in any
// way (only author's .name was special-cased). Used for both author and
// publisher, since Google requires each to be a structured Person/
// Organization object, not plain text.
function validateNestedEntity(
  value: any,
  property: 'author' | 'publisher',
  issues: SchemaIssue[],
): void {
  const entities = Array.isArray(value) ? value : [value]
  for (const entity of entities) {
    if (typeof entity === 'string') {
      issues.push({
        schemaType: property === 'author' ? 'Person' : 'Organization',
        severity: 'warning',
        property,
        message: `"${property}" is plain text, not a structured Person/Organization object — Google's Article guidelines expect a structured entity here, not bare text.`
      })
      continue
    }
    if (typeof entity !== 'object' || entity === null) continue

    const rawType = entity['@type']
    const entityType = Array.isArray(rawType) ? rawType[0] : rawType
    if (!entityType) {
      issues.push({
        schemaType: property === 'author' ? 'Person' : 'Organization',
        severity: 'error',
        property: `${property}.@type`,
        message: `"${property}" is missing @type — Google cannot classify who this is.`
      })
    }
    if (!entity.name) {
      issues.push({
        schemaType: entityType || (property === 'author' ? 'Person' : 'Organization'),
        severity: 'error',
        property: `${property}.name`,
        message: `"${property}" is missing a name.`
      })
    }
    if (property === 'publisher') {
      const logo = entity.logo
      const logoUrl = typeof logo === 'string' ? logo : logo?.url
      if (!isPlausibleUrl(logoUrl)) {
        issues.push({
          schemaType: entityType || 'Organization',
          severity: 'warning',
          property: 'publisher.logo',
          message: "publisher is missing a logo (or it isn't a usable URL) — Google's structured data guidelines list this as a recommended property for full Article rich-result eligibility."
        })
      }
    }
  }
}

function validateBlock(block: any, issues: SchemaIssue[]): void {
  if (block.__parseError) {
    issues.push({
      schemaType: 'unknown',
      severity: 'error',
      property: '(entire block)',
      message: `Invalid JSON — this schema block will not be read by Google or AI engines: ${block.raw}...`
    })
    return
  }

  const rawType = block['@type']
  if (!rawType) {
    issues.push({
      schemaType: 'unknown',
      severity: 'error',
      property: '@type',
      message: 'Missing @type — Google cannot classify this schema block.'
    })
    return
  }
  // @type may legitimately be an array, e.g. ["Article","NewsArticle"]
  const type: string = Array.isArray(rawType) ? rawType[0] : rawType

  const context = block['@context']
  const contextStr = typeof context === 'string' ? context : JSON.stringify(context ?? '')
  if (!context || !contextStr.includes('schema.org')) {
    issues.push({
      schemaType: type,
      severity: 'error',
      property: '@context',
      message: 'Missing or incorrect @context — must be "https://schema.org".'
    })
  }

  const rules = SCHEMA_RULES[type]
  if (!rules) return  // unknown type — skip rule checks, don't fail

  for (const req of rules.required) {
    if (!block[req]) {
      issues.push({
        schemaType: type,
        severity: 'error',
        property: req,
        message: `Missing required property "${req}" for ${type} — this schema is invalid and won't be eligible for rich results.`
      })
    }
  }

  for (const rec of rules.recommended) {
    if (!block[rec]) {
      issues.push({
        schemaType: type,
        severity: 'warning',
        property: rec,
        message: `Missing recommended property "${rec}" for ${type} — schema is valid but not fully optimised.`
      })
    }
  }

  // Nested Person/Organization inside Article/BlogPosting/NewsArticle, and
  // value-shape checks Google's Rich Results Test would actually run, not
  // just "does the property exist" — a schema block can pass every presence
  // check above and still be structurally wrong (a garbage date string, an
  // author that's bare text, an image with no resolvable URL).
  if (type === 'Article' || type === 'BlogPosting' || type === 'NewsArticle') {
    if (block.author) validateNestedEntity(block.author, 'author', issues)
    if (block.publisher) validateNestedEntity(block.publisher, 'publisher', issues)

    for (const dateProp of ['datePublished', 'dateModified'] as const) {
      if (block[dateProp] && !isValidDateString(block[dateProp])) {
        issues.push({
          schemaType: type,
          severity: 'error',
          property: dateProp,
          message: `"${dateProp}" value "${block[dateProp]}" doesn't parse as a valid date — Google requires ISO 8601 (e.g. "2026-08-09T00:00:00Z").`
        })
      }
    }

    if (block.image) {
      const imageUrl = typeof block.image === 'string' ? block.image : block.image?.url
      if (!isPlausibleUrl(imageUrl)) {
        issues.push({
          schemaType: type,
          severity: 'error',
          property: 'image',
          message: 'image property is present but has no usable http(s) URL — Google requires a resolvable image URL for Article rich results.'
        })
      }
    }
  }

  // FAQPage → validate each Question in mainEntity
  if (type === 'FAQPage' && Array.isArray(block.mainEntity)) {
    block.mainEntity.forEach((q: any, i: number) => {
      if (!q?.name) {
        issues.push({
          schemaType: 'Question',
          severity: 'error',
          property: `mainEntity[${i}].name`,
          message: `FAQ question ${i + 1} is missing its question text.`
        })
      }
      if (!q?.acceptedAnswer?.text) {
        issues.push({
          schemaType: 'Question',
          severity: 'error',
          property: `mainEntity[${i}].acceptedAnswer.text`,
          message: `FAQ question ${i + 1} is missing its answer text.`
        })
      }
    })
  }
}

// The generation prompt has Claude write its own Article/BlogPosting JSON-LD
// during generation, before any hero image exists — so it can never know a
// real image URL to embed. This patches the missing `image` property in
// after image generation completes, once a real URL exists, and runs before
// the Quality Gate scores the schema — fixing this in the prompt template
// alone can't work since the URL genuinely doesn't exist at that point.
export function injectMissingArticleImage(html: string, imageUrl: string | undefined): string {
  if (!imageUrl) return html
  const regex = /<script([^>]*type=["']application\/ld\+json["'][^>]*)>([\s\S]*?)<\/script>/gi
  return html.replace(regex, (fullMatch, attrs, jsonText) => {
    try {
      const parsed = JSON.parse(jsonText.trim())
      const rawType = parsed['@type']
      const type = Array.isArray(rawType) ? rawType[0] : rawType
      if ((type === 'Article' || type === 'BlogPosting') && !parsed.image) {
        parsed.image = { '@type': 'ImageObject', url: imageUrl }
        return `<script${attrs}>${JSON.stringify(parsed)}</script>`
      }
      return fullMatch
    } catch {
      return fullMatch
    }
  })
}

export function validateSchema(articleHtml: string): SchemaValidationResult {
  const blocks = extractJsonLdBlocks(articleHtml)
  const issues: SchemaIssue[] = []
  const schemasFound: string[] = []

  for (const block of blocks) {
    const t = block['@type']
    if (t) schemasFound.push(Array.isArray(t) ? t[0] : t)
    validateBlock(block, issues)
  }

  const richResultEligible: Record<string, boolean> = {}
  for (const type of schemasFound) {
    const typeErrors = issues.filter(i => i.schemaType === type && i.severity === 'error')
    richResultEligible[type] = typeErrors.length === 0
  }

  const hasArticle = schemasFound.includes('Article') || schemasFound.includes('BlogPosting')
  // An author may be a nested Person on the Article rather than a top-level block.
  const hasAuthor =
    schemasFound.includes('Person') ||
    blocks.some(b => b?.author && (typeof b.author === 'string' || b.author?.name))

  if (!hasArticle) {
    issues.push({
      schemaType: 'Article',
      severity: 'error',
      property: '(missing entirely)',
      message: 'No Article or BlogPosting schema found on this page at all.'
    })
  }
  if (!hasAuthor) {
    issues.push({
      schemaType: 'Person',
      severity: 'warning',
      property: '(missing entirely)',
      message: 'No Person schema found — named authors are cited significantly more often by AI engines.'
    })
  }

  // Google explicitly disallows more than one conflicting top-level Article
  // definition on the same page — a document-level check, not something a
  // single block can catch on its own.
  const articleTypeCounts: Record<string, number> = {}
  for (const type of schemasFound) {
    if (type === 'Article' || type === 'BlogPosting' || type === 'NewsArticle') {
      articleTypeCounts[type] = (articleTypeCounts[type] || 0) + 1
    }
  }
  for (const [type, count] of Object.entries(articleTypeCounts)) {
    if (count > 1) {
      issues.push({
        schemaType: type,
        severity: 'error',
        property: '(duplicate block)',
        message: `Found ${count} separate ${type} schema blocks on the same page — Google's guidelines expect exactly one; duplicates create conflicting signals about which is authoritative.`
      })
    }
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    schemasFound: Array.from(new Set(schemasFound)),
    issues,
    richResultEligible
  }
}
