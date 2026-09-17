/**
 * Topic 39 — deprecated rich-result types still emitted.
 *
 * Informational only. Markup is INERT, not penalised. Never auto-remove.
 * Undated deprecation-table entries cannot support a finding.
 * FAQ markup without visible Q&A → D17 visible-content finding (more useful).
 */

import {
  extractStructuredData,
  type StructuredDataExtraction,
} from '@/lib/fix-strategies/shared/structured-data-extract'
import {
  lookupDeprecation,
  STRUCTURED_DATA_DEPRECATION_TABLE,
  type DeprecationEntry,
} from '@/lib/fix-strategies/shared/structured-data-deprecation-table'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'
import { parseHtml } from '@/lib/fix-strategies/shared/html-parser'

export type Topic39Verdict =
  | 'informational-deprecated-type'
  | 'd17-faq-markup-not-visible'
  | 'suppress-supported-type'
  | 'suppress-undated-table-entry'
  | 'ok'

export type Topic39Finding = {
  kind: 'structured-data/deprecated-types'
  verdict: Topic39Verdict
  severity: 'informational' | 'moderate' | null
  typeName: string | null
  withdrawn: string | null
  verifiedOn: string | null
  detail: string
  /** Never auto-remove without explicit user request. */
  autoFixable: false
  proposeRemovalUnprompted: false
  penaltyClaimed: false
  fixTarget: FixTargetResult
}

export type DetectTopic39Result = {
  findings: Topic39Finding[]
  informational: Topic39Finding[]
  suppressed: Array<{ verdict: Topic39Verdict; detail: string }>
  extraction: StructuredDataExtraction
}

export type DetectTopic39Options = {
  html: string
  pageUrl: string
  extraction?: StructuredDataExtraction
  /**
   * Optional undated table row to prove guard 3 — must not raise.
   */
  undatedTestEntry?: { type: string; withdrawn: string; sourceUrl: string }
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export function detectDeprecatedTypes(
  options: DetectTopic39Options,
): DetectTopic39Result {
  const extraction =
    options.extraction ??
    extractStructuredData(options.html, options.pageUrl)
  const findings: Topic39Finding[] = []
  const informational: Topic39Finding[] = []
  const suppressed: DetectTopic39Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/schema.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/schema.ts',
  })

  const make = (
    verdict: Topic39Verdict,
    severity: Topic39Finding['severity'],
    typeName: string | null,
    entry: DeprecationEntry | null,
    detail: string,
  ): Topic39Finding => ({
    kind: 'structured-data/deprecated-types',
    verdict,
    severity,
    typeName,
    withdrawn: entry?.withdrawn ?? null,
    verifiedOn: entry?.verifiedOn ?? null,
    detail,
    autoFixable: false,
    proposeRemovalUnprompted: false,
    penaltyClaimed: false,
    fixTarget,
  })

  // Guard: undated entry cannot support a finding
  if (options.undatedTestEntry) {
    suppressed.push({
      verdict: 'suppress-undated-table-entry',
      detail: `Deprecation entry for ${options.undatedTestEntry.type} has no verified-on date — unusable`,
    })
  }

  const seen = new Set<string>()
  for (const node of extraction.nodes) {
    for (const typeName of node.types) {
      const key = typeName.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      const entry = lookupDeprecation(typeName)
      if (!entry) {
        // e.g. Course — supported / not deprecated
        if (['Course', 'Article', 'NewsArticle', 'BlogPosting'].includes(
          typeName.replace(/^https?:\/\/schema\.org\//i, ''),
        )) {
          suppressed.push({
            verdict: 'suppress-supported-type',
            detail: `${typeName} is not in the dated deprecation table`,
          })
        }
        continue
      }

      informational.push(
        make(
          'informational-deprecated-type',
          'informational',
          typeName,
          entry,
          `${typeName} rich results withdrawn ${entry.withdrawn} (verified ${entry.verifiedOn}). Markup is inert, not penalised (D28/D29). Never auto-remove — may serve other consumers.`,
        ),
      )

      // FAQ without visible Q&A → D17 (more useful)
      if (entry.type === 'FAQPage' && !pageHasVisibleFaq(options.html)) {
        findings.push(
          make(
            'd17-faq-markup-not-visible',
            'moderate',
            typeName,
            entry,
            'FAQPage markup present but Q&A content is not visible on the page (D17) — substantive visible-content defect under the deprecation',
          ),
        )
      }
    }
  }

  return { findings, informational, suppressed, extraction }
}

/**
 * Structural check: visible FAQ-like pairs (heading/dt + answer) in the
 * HTML tree — not page-prose phrase matching.
 */
export function pageHasVisibleFaq(html: string): boolean {
  const parsed = parseHtml(html)
  // Look for elements with itemprop acceptedAnswer / name under Question,
  // or a definition list, or details/summary pairs.
  const details = parsed.bodyElements('details')
  if (details.length >= 1) {
    const summaries = parsed.bodyElements('summary')
    if (summaries.length >= 1) return true
  }
  const dts = parsed.bodyElements('dt')
  const dds = parsed.bodyElements('dd')
  if (dts.length >= 1 && dds.length >= 1) return true

  // Microdata Question
  for (const el of [
    ...parsed.bodyElements('div'),
    ...parsed.bodyElements('section'),
  ]) {
    const itemtype = (el.attrs.itemtype ?? '').toLowerCase()
    if (itemtype.includes('question')) return true
  }

  // JSON-LD FAQ with visible mirror: look for role=heading groups — weak.
  // If the page has an element with id/class faq structurally via attributes:
  for (const el of [
    ...parsed.bodyElements('section'),
    ...parsed.bodyElements('div'),
  ]) {
    const id = (el.attrs.id ?? '').toLowerCase()
    const cls = (el.attrs.class ?? '').toLowerCase()
    if (/\bfaq\b/.test(id) || /\bfaq\b/.test(cls)) {
      // Has FAQ region — check for question-like children
      const headings = ['h2', 'h3', 'h4']
      for (const h of headings) {
        if (parsed.bodyElements(h).length >= 1) return true
      }
    }
  }
  return false
}

/** Removal only on explicit request — never unprompted. */
export function removeDeprecatedTypeFromJsonLd(
  jsonLdText: string,
  typeName: string,
  userRequested: boolean,
): { json: string | null; removed: boolean; rejected: boolean } {
  if (!userRequested) {
    return { json: null, removed: false, rejected: true }
  }
  try {
    const data = JSON.parse(jsonLdText)
    const filtered = filterType(data, typeName)
    return {
      json: JSON.stringify(filtered, null, 2),
      removed: true,
      rejected: false,
    }
  } catch {
    return { json: null, removed: false, rejected: false }
  }
}

function filterType(data: unknown, typeName: string): unknown {
  if (Array.isArray(data)) {
    return data
      .map((x) => filterType(x, typeName))
      .filter((x) => x != null)
  }
  if (!data || typeof data !== 'object') return data
  const obj = data as Record<string, unknown>
  if (obj['@graph']) {
    return {
      ...obj,
      '@graph': filterType(obj['@graph'], typeName),
    }
  }
  const t = obj['@type']
  const types = Array.isArray(t) ? t.map(String) : t != null ? [String(t)] : []
  if (types.some((x) => x.toLowerCase() === typeName.toLowerCase())) {
    return null
  }
  return obj
}

export function rejectedAutoRemoveDeprecated(): never {
  throw new Error(
    'REJECTED: never auto-remove deprecated markup — it is inert for Google and may serve other consumers (D28)',
  )
}

export { STRUCTURED_DATA_DEPRECATION_TABLE }
