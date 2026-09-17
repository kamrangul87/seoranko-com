/**
 * Topic 37 — invalid or mismatched @type / properties / @context.
 *
 * Valid schema.org types Google does not support → NEVER raise.
 * Validate against vocabulary snapshot, not a hardcoded Google-only subset.
 * Never infer Person vs Organization from a name — only from repo source.
 * Never guess non-trivial JSON-LD repairs.
 */

import {
  extractStructuredData,
  type StructuredDataExtraction,
  type StructuredDataNode,
} from '@/lib/fix-strategies/shared/structured-data-extract'
import {
  classifyTypeName,
  isPropertyValidForType,
  SCHEMA_ORG_VOCAB_SNAPSHOT,
} from '@/lib/fix-strategies/shared/schema-org-vocabulary'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic37Verdict =
  | 'ok'
  | 'critical-jsonld-parse-failure'
  | 'auto-fix-trailing-comma'
  | 'human-review-ambiguous-parse'
  | 'auto-fix-type-spelling'
  | 'auto-fix-context'
  | 'auto-fix-thing-to-person-or-org'
  | 'human-review-entity-kind'
  | 'human-review-invalid-property'
  | 'suppress-valid-unsupported-type'
  | 'suppress-type-array-ok'
  | 'suppress-infer-from-name'

export type Topic37Finding = {
  kind: 'structured-data/invalid-or-mismatched-type'
  verdict: Topic37Verdict
  severity: 'high' | 'moderate' | 'critical' | null
  detail: string
  autoFixable: boolean
  suggestion: string | null
  vocabSnapshot: string
  fixTarget: FixTargetResult
}

export type DetectTopic37Result = {
  findings: Topic37Finding[]
  suppressed: Array<{ verdict: Topic37Verdict; detail: string }>
  extraction: StructuredDataExtraction
}

export type DetectTopic37Options = {
  html: string
  pageUrl: string
  extraction?: StructuredDataExtraction
  /** Repo-supplied entity kind for author/publisher — never from name. */
  authorEntityKind?: 'Person' | 'Organization' | null
  publisherEntityKind?: 'Person' | 'Organization' | null
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export function detectInvalidOrMismatchedType(
  options: DetectTopic37Options,
): DetectTopic37Result {
  const extraction =
    options.extraction ??
    extractStructuredData(options.html, options.pageUrl)
  const findings: Topic37Finding[] = []
  const suppressed: DetectTopic37Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/schema.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/schema.ts',
  })
  const snap = SCHEMA_ORG_VOCAB_SNAPSHOT.version

  const make = (
    verdict: Topic37Verdict,
    severity: Topic37Finding['severity'],
    detail: string,
    autoFixable: boolean,
    suggestion: string | null = null,
  ): Topic37Finding => ({
    kind: 'structured-data/invalid-or-mismatched-type',
    verdict,
    severity,
    detail,
    autoFixable,
    suggestion,
    vocabSnapshot: snap,
    fixTarget,
  })

  // Parse failures — more severe than invalid type
  for (const fail of extraction.parseFailures) {
    if (fail.unambiguousSyntaxHint === 'trailing-comma') {
      findings.push(
        make(
          'auto-fix-trailing-comma',
          'critical',
          `JSON-LD does not parse (trailing comma) — unambiguous repair. ${fail.detail}`,
          true,
        ),
      )
    } else {
      findings.push(
        make(
          'human-review-ambiguous-parse',
          'critical',
          `JSON-LD does not parse — non-trivial repair rejected (wrong guess changes meaning). ${fail.detail}`,
          false,
        ),
      )
    }
  }

  for (const node of extraction.nodes) {
    // @context
    const ctxOk = contextIsSchemaOrg(node.context)
    if (!ctxOk) {
      findings.push(
        make(
          'auto-fix-context',
          'high',
          `@context missing or wrong (${JSON.stringify(node.context)}) — set https://schema.org`,
          true,
          'https://schema.org',
        ),
      )
    }

    // @type array is permitted
    if (node.types.length > 1) {
      suppressed.push({
        verdict: 'suppress-type-array-ok',
        detail: `@type array of ${node.types.length} types — permitted; validate each`,
      })
    }

    for (const typeName of node.types) {
      const classified = classifyTypeName(typeName)
      if (classified.kind === 'invalid-misspelling') {
        findings.push(
          make(
            'auto-fix-type-spelling',
            'high',
            `@type "${typeName}" is not a schema.org type — unambiguous correction → ${classified.suggestion}`,
            true,
            classified.suggestion,
          ),
        )
      } else if (classified.kind === 'invalid') {
        findings.push(
          make(
            'auto-fix-type-spelling',
            'high',
            `@type "${typeName}" is not a valid schema.org type name`,
            false,
          ),
        )
      } else if (classified.kind === 'valid-unknown') {
        // e.g. Course — valid markup Google may not feature. NEVER raise.
        suppressed.push({
          verdict: 'suppress-valid-unsupported-type',
          detail: `@type "${typeName}" not in snapshot but well-formed — valid markup, never raise (may be extension / unsupported feature)`,
        })
      }

      // Properties
      for (const prop of Object.keys(node.properties)) {
        if (prop.includes('.') || prop.includes('[')) continue // nested paths
        if (prop.startsWith('@')) continue
        const validity = isPropertyValidForType(typeName, prop)
        if (validity === 'invalid') {
          findings.push(
            make(
              'human-review-invalid-property',
              'moderate',
              `Property "${prop}" not valid for ${typeName} per schema.org — propose removal or correct property; do not apply when meaning ambiguous`,
              false,
            ),
          )
        }
      }
    }

    // Thing used for author/publisher (D15)
    checkEntityKind(
      node,
      'author',
      options.authorEntityKind ?? null,
      make,
      findings,
      suppressed,
    )
    checkEntityKind(
      node,
      'publisher',
      options.publisherEntityKind ?? null,
      make,
      findings,
      suppressed,
    )
  }

  return { findings, suppressed, extraction }
}

function contextIsSchemaOrg(
  ctx: string | string[] | null,
): boolean {
  if (ctx == null) return false
  const list = Array.isArray(ctx) ? ctx : [ctx]
  return list.some(
    (c) =>
      typeof c === 'string' &&
      /schema\.org/i.test(c),
  )
}

function checkEntityKind(
  node: StructuredDataNode,
  field: 'author' | 'publisher',
  repoKind: 'Person' | 'Organization' | null,
  make: (
    v: Topic37Verdict,
    s: Topic37Finding['severity'],
    d: string,
    a: boolean,
    sug?: string | null,
  ) => Topic37Finding,
  findings: Topic37Finding[],
  suppressed: Array<{ verdict: Topic37Verdict; detail: string }>,
): void {
  const val = node.properties[field]
  if (val == null) return
  const objs = Array.isArray(val) ? val : [val]
  for (const obj of objs) {
    if (!obj || typeof obj !== 'object') continue
    const t = (obj as Record<string, unknown>)['@type']
    const typeStr = t != null ? String(t) : null
    if (typeStr === 'Thing' || typeStr == null) {
      if (repoKind) {
        findings.push(
          make(
            'auto-fix-thing-to-person-or-org',
            'moderate',
            `${field} typed as ${typeStr ?? 'missing'} — set ${repoKind} from repo entity kind (D15)`,
            true,
            repoKind,
          ),
        )
      } else {
        findings.push(
          make(
            'human-review-entity-kind',
            'moderate',
            `${field} typed as ${typeStr ?? 'missing'} — Person vs Organization requires repo source; never infer from name`,
            false,
          ),
        )
        suppressed.push({
          verdict: 'suppress-infer-from-name',
          detail: 'Entity kind must not be inferred from a name string',
        })
      }
    }
  }
}

export function rejectedInferEntityKindFromName(): never {
  throw new Error(
    'REJECTED: never infer whether an author is a Person or Organization from the name',
  )
}

export function rejectedGuessJsonLdRepair(): never {
  throw new Error(
    'REJECTED: never guess non-trivial JSON-LD syntax repairs — a wrong repair changes meaning silently',
  )
}

/** Deterministic trailing-comma repair only. */
export function repairTrailingCommas(jsonText: string): string {
  return jsonText.replace(/,(\s*[}\]])/g, '$1')
}

export function ensureSchemaOrgContext(obj: Record<string, unknown>): void {
  obj['@context'] = 'https://schema.org'
}
