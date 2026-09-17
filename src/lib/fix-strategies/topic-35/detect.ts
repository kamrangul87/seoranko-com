/**
 * Topic 35 — required properties absent (per Search feature table).
 *
 * NO global required list. Article/NewsArticle/BlogPosting have NO required
 * properties — image/author/dates are RECOMMENDED only. Unknown types → no
 * finding. Never apply 1200px / 800k image thresholds (use 50K width×height).
 */

import {
  extractStructuredData,
  getProp,
  hasNonEmptyProp,
  type StructuredDataExtraction,
  type StructuredDataNode,
} from '@/lib/fix-strategies/shared/structured-data-extract'
import {
  lookupRequirement,
  ARTICLE_IMAGE_MIN_PIXELS,
  type FeatureRequirementEntry,
} from '@/lib/fix-strategies/shared/structured-data-requirement-table'
import { lookupDeprecation } from '@/lib/fix-strategies/shared/structured-data-deprecation-table'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic35Verdict =
  | 'finding-required-absent'
  | 'informational-recommended-absent'
  | 'auto-fix-author-name-cleanup'
  | 'auto-fix-split-merged-authors'
  | 'auto-fix-scaffold-from-repo'
  | 'suppress-unknown-type'
  | 'suppress-article-recommended-only'
  | 'route-topic-39-deprecated'
  | 'ok'

export type Topic35Finding = {
  kind: 'structured-data/required-properties-absent'
  verdict: Topic35Verdict
  severity: 'high' | 'informational' | null
  typeName: string
  property: string | null
  detail: string
  autoFixable: boolean
  /** Never a 1200 / 800000 image rule. */
  imageMinPixelsApplied: number | null
  fixTarget: FixTargetResult
}

export type DetectTopic35Result = {
  findings: Topic35Finding[]
  informational: Topic35Finding[]
  suppressed: Array<{ verdict: Topic35Verdict; detail: string }>
  extraction: StructuredDataExtraction
}

export type DetectTopic35Options = {
  html: string
  pageUrl: string
  /** Pre-built extraction (shared across 35/36/37/39). */
  extraction?: StructuredDataExtraction
  /** Repo machine-readable values for scaffolding required props. */
  repoPropertyValues?: Record<string, string>
  /**
   * Author entity kind from repo (Person | Organization). Never inferred
   * from the name string.
   */
  authorEntityKind?: 'Person' | 'Organization' | null
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export function detectRequiredPropertiesAbsent(
  options: DetectTopic35Options,
): DetectTopic35Result {
  const extraction =
    options.extraction ??
    extractStructuredData(options.html, options.pageUrl)
  const findings: Topic35Finding[] = []
  const informational: Topic35Finding[] = []
  const suppressed: DetectTopic35Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/schema.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/schema.ts',
  })

  for (const node of extraction.nodes) {
    for (const typeName of node.types) {
      const dep = lookupDeprecation(typeName)
      if (dep) {
        suppressed.push({
          verdict: 'route-topic-39-deprecated',
          detail: `${typeName} is deprecated for rich results — topic 39`,
        })
        continue
      }

      const req = lookupRequirement(typeName)
      if (!req) {
        suppressed.push({
          verdict: 'suppress-unknown-type',
          detail: `${typeName} has no requirement-table entry — unknown is not non-compliant`,
        })
        continue
      }

      classifyNode(node, typeName, req, options, fixTarget, findings, informational, suppressed)
    }
  }

  return { findings, informational, suppressed, extraction }
}

function classifyNode(
  node: StructuredDataNode,
  typeName: string,
  req: FeatureRequirementEntry,
  options: DetectTopic35Options,
  fixTarget: FixTargetResult,
  findings: Topic35Finding[],
  informational: Topic35Finding[],
  suppressed: DetectTopic35Result['suppressed'],
): void {
  const make = (
    verdict: Topic35Verdict,
    severity: Topic35Finding['severity'],
    property: string | null,
    detail: string,
    autoFixable: boolean,
  ): Topic35Finding => ({
    kind: 'structured-data/required-properties-absent',
    verdict,
    severity,
    typeName,
    property,
    detail,
    autoFixable,
    imageMinPixelsApplied: req.imageMinPixels ?? null,
    fixTarget,
  })

  // Author name cleanup / merged authors (deterministic regardless of required)
  const authorName = getProp(node, 'author.name')
  const author = getProp(node, 'author')
  if (typeof authorName === 'string' && authorNameNeedsCleanup(authorName)) {
    findings.push(
      make(
        'auto-fix-author-name-cleanup',
        null,
        'author.name',
        `author.name polluted with honorific/job/publisher/intro words (D14): "${authorName}"`,
        true,
      ),
    )
  }
  if (typeof authorName === 'string' && looksMergedAuthors(authorName)) {
    findings.push(
      make(
        'auto-fix-split-merged-authors',
        null,
        'author',
        `Multiple authors merged into one author.name field (D13): "${authorName}"`,
        true,
      ),
    )
  }
  // Also check string author
  if (typeof author === 'string' && looksMergedAuthors(author)) {
    findings.push(
      make(
        'auto-fix-split-merged-authors',
        null,
        'author',
        `Multiple authors merged into one author field (D13): "${author}"`,
        true,
      ),
    )
  }

  // Required
  for (const prop of req.required) {
    if (hasNonEmptyProp(node, prop)) continue
    const repoVal = options.repoPropertyValues?.[prop]
    if (repoVal) {
      findings.push(
        make(
          'auto-fix-scaffold-from-repo',
          'high',
          prop,
          `Required ${prop} absent but present in repo machine-readable source`,
          true,
        ),
      )
    } else {
      findings.push(
        make(
          'finding-required-absent',
          'high',
          prop,
          `Required property ${prop} absent — item ineligible for ${typeName} rich result (D1)`,
          false,
        ),
      )
    }
  }

  // Recommended — informational only; Article image/author/dates are NEVER errors
  const isArticleFamily = ['Article', 'NewsArticle', 'BlogPosting'].includes(
    typeName,
  )
  for (const prop of req.recommended) {
    if (hasNonEmptyProp(node, prop)) continue
    if (isArticleFamily && req.required.length === 0) {
      // Explicit suppress path for the classic false positive
      if (['image', 'author', 'author.name', 'datePublished', 'dateModified', 'headline'].includes(prop)) {
        suppressed.push({
          verdict: 'suppress-article-recommended-only',
          detail: `${typeName}.${prop} is recommended, not required (D7) — never an error`,
        })
        continue
      }
    }
    informational.push(
      make(
        'informational-recommended-absent',
        'informational',
        prop,
        `Recommended property ${prop} absent — item stays eligible (D2)`,
        false,
      ),
    )
  }

  if (
    req.required.length === 0 &&
    findings.filter((f) => f.typeName === typeName && f.verdict === 'finding-required-absent')
      .length === 0
  ) {
    // ok for required; recommended handled above
  }
}

/** D14 — name polluted with job title, honorific, publisher, intro words. */
export function authorNameNeedsCleanup(name: string): boolean {
  const n = name.trim()
  if (/^(posted by|written by|by)\s+/i.test(n)) return true
  if (/\b(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i.test(n) && /,/.test(n)) return true
  if (/\b(Editor|Journalist|Correspondent|CEO|Founder)\b/i.test(n)) return true
  return false
}

/** D13 — "Jane Doe and John Smith" or comma-separated people. */
export function looksMergedAuthors(name: string): boolean {
  if (/\band\b/i.test(name)) return true
  // "Jane Doe, John Smith" — two capitalized name-like segments
  const parts = name.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 2 && parts.every((p) => /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(p))) {
    return true
  }
  return false
}

export function cleanAuthorName(name: string): {
  name: string
  jobTitle: string | null
  honorificPrefix: string | null
} {
  let n = name.trim()
  n = n.replace(/^(posted by|written by|by)\s+/i, '')
  let honorificPrefix: string | null = null
  const hon = n.match(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i)
  if (hon) {
    honorificPrefix = hon[1]!
    n = n.slice(hon[0].length)
  }
  let jobTitle: string | null = null
  const job = n.match(/,\s*(Editor|Journalist|Correspondent|CEO|Founder)\s*$/i)
  if (job) {
    jobTitle = job[1]!
    n = n.slice(0, job.index).trim()
  }
  return { name: n.trim(), jobTitle, honorificPrefix }
}

export function splitMergedAuthors(name: string): string[] {
  return name
    .split(/\s+and\s+|,\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

export { ARTICLE_IMAGE_MIN_PIXELS }
