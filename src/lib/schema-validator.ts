/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/schema-validator.ts
// Validates JSON-LD against schema.org required/recommended properties for the
// types SEORANKO generates. Runs in-pipeline before save rather than being
// discovered later by an external audit tool.

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

  // Nested Person/Organization inside Article
  if ((type === 'Article' || type === 'BlogPosting') && block.author) {
    const authors = Array.isArray(block.author) ? block.author : [block.author]
    for (const author of authors) {
      if (typeof author === 'object' && author !== null && !author.name) {
        issues.push({
          schemaType: 'Person (nested in Article.author)',
          severity: 'error',
          property: 'author.name',
          message: 'Article author is missing a name property.'
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

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    schemasFound: Array.from(new Set(schemasFound)),
    issues,
    richResultEligible
  }
}
