/**
 * Topic 47 — invalid language/region codes (Google hreflang set).
 *
 * MUST NOT reuse topic 34's BCP 47 grammar. Google's set is narrower:
 * ISO 639-1 + ISO 3166-1 Alpha-2 + ISO 15924, minus exclusions.
 * es-419 and en-UK are valid BCP 47 and rejected here; zh-Hans-US is accepted.
 * x-default is a permitted literal; its absence is not a defect.
 */

import {
  collectHreflangAnnotations,
  hreflangKey,
  type HreflangInspection,
  type CollectHreflangOptions,
} from '@/lib/fix-strategies/shared/hreflang-inspect'
import {
  validateGoogleHreflangCode,
  isoTablesAreDated,
  HREFLANG_ISO_SNAPSHOT_META,
  type HreflangIsoSnapshotMeta,
} from '@/lib/fix-strategies/shared/hreflang-iso-tables'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic47Verdict =
  | 'auto-fix-en-uk-to-en-gb'
  | 'auto-fix-inverted-order'
  | 'auto-fix-case-convention'
  | 'auto-fix-x-default-strip-language'
  | 'human-review-region-only'
  | 'human-review-es-419'
  | 'human-review-duplicate-conflicting'
  | 'finding-invalid-code'
  | 'suppress-x-default-absent'
  | 'suppress-valid-script-region'
  | 'suppress-x-default-ok'
  | 'suppress-undated-tables'
  | 'ok'

export type Topic47Finding = {
  kind: 'hreflang/invalid-language-region-codes'
  verdict: Topic47Verdict
  severity: 'high' | 'moderate' | null
  hreflangRaw: string
  normalized: string | null
  sourceUrl: string
  detail: string
  autoFixable: boolean
  fixTarget: FixTargetResult
}

export type DetectTopic47Result = {
  findings: Topic47Finding[]
  suppressed: Array<{ verdict: Topic47Verdict; detail: string }>
  inspection: HreflangInspection
}

export type DetectTopic47Options = {
  inspection?: HreflangInspection
  collect?: CollectHreflangOptions
  /** Override snapshot (tests for undated tables). */
  isoMeta?: HreflangIsoSnapshotMeta
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export function detectInvalidLanguageRegionCodes(
  options: DetectTopic47Options,
): DetectTopic47Result {
  const inspection =
    options.inspection ??
    collectHreflangAnnotations(
      options.collect ?? { originUrl: 'https://example.com', pages: [] },
    )
  const meta = options.isoMeta ?? HREFLANG_ISO_SNAPSHOT_META
  const findings: Topic47Finding[] = []
  const suppressed: DetectTopic47Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/i18n.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/i18n.ts',
  })

  if (!isoTablesAreDated(meta)) {
    suppressed.push({
      verdict: 'suppress-undated-tables',
      detail: 'ISO snapshot undated — cannot support a finding',
    })
    return { findings, suppressed, inspection }
  }

  let sawXDefault = false
  // code → list of normalized targets (across cluster)
  const codeTargets = new Map<string, Set<string>>()

  for (const page of inspection.pages) {
    for (const a of page.effectiveAnnotations) {
      const key = hreflangKey(a.hreflangRaw)
      if (key === 'x-default') sawXDefault = true

      if (a.hrefNormalized) {
        const set = codeTargets.get(key) ?? new Set()
        set.add(a.hrefNormalized)
        codeTargets.set(key, set)
      }

      const v = validateGoogleHreflangCode(a.hreflangRaw, meta)
      if (v.ok) {
        if (v.kind === 'x-default') {
          suppressed.push({
            verdict: 'suppress-x-default-ok',
            detail: 'x-default is a permitted literal (G20)',
          })
        } else if (
          v.kind === 'language-script' ||
          v.kind === 'language-script-region'
        ) {
          suppressed.push({
            verdict: 'suppress-valid-script-region',
            detail: `${a.hreflangRaw} accepted (ISO 15924 / G16)`,
          })
        }
        if (v.caseConventionIssue) {
          findings.push({
            kind: 'hreflang/invalid-language-region-codes',
            verdict: 'auto-fix-case-convention',
            severity: 'moderate',
            hreflangRaw: a.hreflangRaw,
            normalized: v.normalized,
            sourceUrl: page.urlNormalized,
            detail: `Case convention ${a.hreflangRaw} → ${v.normalized} (G11)`,
            autoFixable: true,
            fixTarget,
          })
        }
        continue
      }

      if (v.reason === 'undated-tables') {
        suppressed.push({
          verdict: 'suppress-undated-tables',
          detail: v.detail,
        })
        continue
      }

      if (v.reason === 'es-419') {
        findings.push({
          kind: 'hreflang/invalid-language-region-codes',
          verdict: 'human-review-es-419',
          severity: 'high',
          hreflangRaw: a.hreflangRaw,
          normalized: null,
          sourceUrl: page.urlNormalized,
          detail: v.detail,
          autoFixable: false,
          fixTarget,
        })
        continue
      }

      if (v.reason === 'region-only') {
        findings.push({
          kind: 'hreflang/invalid-language-region-codes',
          verdict: 'human-review-region-only',
          severity: 'high',
          hreflangRaw: a.hreflangRaw,
          normalized: null,
          sourceUrl: page.urlNormalized,
          detail: v.detail,
          autoFixable: false,
          fixTarget,
        })
        continue
      }

      if (v.reason === 'x-default-with-language') {
        findings.push({
          kind: 'hreflang/invalid-language-region-codes',
          verdict: 'auto-fix-x-default-strip-language',
          severity: 'moderate',
          hreflangRaw: a.hreflangRaw,
          normalized: 'x-default',
          sourceUrl: page.urlNormalized,
          detail: v.detail,
          autoFixable: true,
          fixTarget,
        })
        continue
      }

      if (v.reason === 'inverted-order') {
        findings.push({
          kind: 'hreflang/invalid-language-region-codes',
          verdict: 'auto-fix-inverted-order',
          severity: 'high',
          hreflangRaw: a.hreflangRaw,
          normalized: v.autoFixTo,
          sourceUrl: page.urlNormalized,
          detail: v.detail,
          autoFixable: true,
          fixTarget,
        })
        continue
      }

      if (v.reason === 'reserved-region' && v.autoFixable && v.autoFixTo) {
        findings.push({
          kind: 'hreflang/invalid-language-region-codes',
          verdict: 'auto-fix-en-uk-to-en-gb',
          severity: 'high',
          hreflangRaw: a.hreflangRaw,
          normalized: v.autoFixTo,
          sourceUrl: page.urlNormalized,
          detail: v.detail,
          autoFixable: true,
          fixTarget,
        })
        continue
      }

      findings.push({
        kind: 'hreflang/invalid-language-region-codes',
        verdict: 'finding-invalid-code',
        severity: 'high',
        hreflangRaw: a.hreflangRaw,
        normalized: v.autoFixTo,
        sourceUrl: page.urlNormalized,
        detail: v.detail,
        autoFixable: v.autoFixable,
        fixTarget,
      })
    }
  }

  // Duplicate locale code → conflicting URLs (G4)
  for (const [code, targets] of codeTargets) {
    if (targets.size > 1) {
      findings.push({
        kind: 'hreflang/invalid-language-region-codes',
        verdict: 'human-review-duplicate-conflicting',
        severity: 'high',
        hreflangRaw: code,
        normalized: null,
        sourceUrl: inspection.originUrl,
        detail: `Duplicate hreflang "${code}" points at conflicting URLs: ${Array.from(targets).join(', ')}`,
        autoFixable: false,
        fixTarget,
      })
    }
  }

  // x-default absent — not a defect (G19)
  if (!sawXDefault) {
    suppressed.push({
      verdict: 'suppress-x-default-absent',
      detail: 'x-default absent is recommended-not-required (G19) — never raise',
    })
  }

  return { findings, suppressed, inspection }
}

/** Never reuse topic 34 BCP 47 for Google hreflang. */
export function rejectedReuseTopic34Bcp47(): never {
  throw new Error(
    'topic 47: must not reuse topic 34 BCP 47 validator — Google set is narrower',
  )
}

/** Never auto-replace es-419. */
export function rejectedAutoReplaceEs419(): never {
  throw new Error(
    'topic 47: es-419 replacement is a business decision — human-review only',
  )
}
