/**
 * Topic 34 — language declaration missing or wrong.
 *
 * Standards / a11y finding — NO Search claim (L6).
 * lang="" is VALID. Validate BCP 47 grammar, never a language-name list.
 * Auto-fix only from an authoritative repo source. Never default to en.
 */

import type { HeadInspection } from '@/lib/fix-strategies/shared/head-inspect'
import { isValidBcp47, isIso6391, bcp47TagsCompatible } from '@/lib/fix-strategies/shared/bcp47'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic34Verdict =
  | 'ok'
  | 'human-review-missing-lang'
  | 'auto-set-lang-from-locale'
  | 'high-invalid-bcp47'
  | 'auto-correct-lang-from-locale'
  | 'low-lang-inlanguage-disagree'
  | 'high-book-missing-inlanguage'
  | 'moderate-invalid-inlanguage'
  | 'moderate-book-not-iso6391'
  | 'suppress-empty-lang-valid'
  | 'suppress-article-no-inlanguage'
  | 'suppress-nested-lang-override'
  | 'suppress-no-authoritative-source'
  /** 3xx Location points at a different host — do not assess lang here. */
  | 'suppress-cross-host-redirect'

export type Topic34Finding = {
  kind: 'head/lang-declaration'
  verdict: Topic34Verdict
  severity: 'high' | 'moderate' | 'low' | null
  detail: string
  autoFixable: boolean
  proposedLang: string | null
  /** Never claim Google uses lang for detection. */
  searchClaim: false
  fixTarget: FixTargetResult
}

export type DetectTopic34Result = {
  findings: Topic34Finding[]
  suppressed: Array<{ verdict: Topic34Verdict; detail: string }>
}

export type DetectTopic34Options = {
  inspection: HeadInspection
  /**
   * Authoritative locale from route segment / i18n config / page config.
   * Required for auto-fix. Never guess "en".
   */
  authoritativeLocale?: string | null
  /** Localized routes may override root lang. */
  hasLocalizedRoutes?: boolean
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /**
   * When the crawl response is a 3xx whose Location is on another host,
   * lang must not be assessed on this URL (final host owns the document).
   * Absolute URL of the Location target when that is cross-host.
   */
  crossHostRedirectLocation?: string | null
}

/** True when Location resolves to a different host than `pageUrl`. */
export function crossHostRedirectLocation(
  pageUrl: string,
  status: number | null | undefined,
  locationHeader: string | null | undefined,
): string | null {
  if (status == null || status < 300 || status >= 400) return null
  const raw = locationHeader?.trim()
  if (!raw) return null
  try {
    const from = new URL(pageUrl)
    const to = new URL(raw, from)
    if (to.host.toLowerCase() === from.host.toLowerCase()) return null
    return to.href
  } catch {
    return null
  }
}

export function detectLangDeclaration(
  options: DetectTopic34Options,
): DetectTopic34Result {
  const findings: Topic34Finding[] = []
  const suppressed: DetectTopic34Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/layout.tsx',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })
  const insp = options.inspection
  const auth = options.authoritativeLocale?.trim() || null

  // Cross-host 3xx: the document (and lang) live on the Location host.
  // Assessing lang on the redirect response is a false positive
  // (e.g. autodun.com/mot-predictor → mot.autodun.com with lang="en").
  const crossHost = options.crossHostRedirectLocation?.trim() || null
  if (crossHost) {
    suppressed.push({
      verdict: 'suppress-cross-host-redirect',
      detail: `Cross-host redirect to ${crossHost} — lang is not assessed on this URL.`,
    })
    return { findings, suppressed }
  }

  const make = (
    verdict: Topic34Verdict,
    severity: Topic34Finding['severity'],
    detail: string,
    autoFixable: boolean,
    proposedLang: string | null = null,
  ): Topic34Finding => ({
    kind: 'head/lang-declaration',
    verdict,
    severity,
    detail,
    autoFixable,
    proposedLang,
    searchClaim: false,
    fixTarget,
  })

  // lang present
  if (insp.htmlLangPresent) {
    const lang = insp.htmlLang ?? ''

    // Empty string is VALID
    if (lang === '') {
      suppressed.push({
        verdict: 'suppress-empty-lang-valid',
        detail: 'lang="" is valid per BCP 47 / L2 — never raise',
      })
    } else if (!isValidBcp47(lang)) {
      if (auth && isValidBcp47(auth) && !options.hasLocalizedRoutes) {
        findings.push(
          make(
            'auto-correct-lang-from-locale',
            'high',
            `lang="${lang}" is not a valid BCP 47 tag — correct from authoritative locale ${auth}. No Search claim (L6).`,
            true,
            auth,
          ),
        )
      } else {
        findings.push(
          make(
            'high-invalid-bcp47',
            'high',
            `lang="${lang}" is not a valid BCP 47 tag. No Search claim (L6).` +
              (auth ? '' : ' No authoritative locale — human-review.'),
            false,
            auth,
          ),
        )
      }
    } else {
      // Valid lang — check inLanguage disagreement at document level.
      // Primary-subtag prefix matches (en vs en-GB) are compatible, not
      // disagreement — only raise when tags are incompatible.
      const docLangs = insp.inLanguage.filter((r) => r.documentLevel)
      for (const rec of docLangs) {
        if (
          rec.value &&
          isValidBcp47(rec.value) &&
          !bcp47TagsCompatible(lang, rec.value)
        ) {
          findings.push(
            make(
              'low-lang-inlanguage-disagree',
              'low',
              `lang="${lang}" disagrees with inLanguage="${rec.value}" on ${rec.entityType ?? 'entity'}. Align to authoritative source; do not pick arbitrarily. No Search claim.`,
              false,
              auth,
            ),
          )
        }
      }
      if (findings.length === 0) {
        suppressed.push({
          verdict: 'ok',
          detail: `Valid BCP 47 lang="${lang}" — no Search claim (L6)`,
        })
      }
    }
  } else {
    // Missing lang
    if (auth && isValidBcp47(auth) && !options.hasLocalizedRoutes) {
      findings.push(
        make(
          'auto-set-lang-from-locale',
          'moderate',
          `No lang on <html> — set from authoritative locale ${auth}. Accessibility (L5). No Search claim (L6). Never default to en.`,
          true,
          auth,
        ),
      )
    } else if (options.hasLocalizedRoutes) {
      findings.push(
        make(
          'human-review-missing-lang',
          'moderate',
          'No lang on <html>; localized routes present — root lang may be overridden per route. Human-review. No Search claim.',
          false,
          auth,
        ),
      )
    } else if (!auth) {
      findings.push(
        make(
          'human-review-missing-lang',
          'moderate',
          'No lang on <html> and no authoritative locale in repo — human-review. Never guess lang="en". No Search claim (L6).',
          false,
          null,
        ),
      )
      suppressed.push({
        verdict: 'suppress-no-authoritative-source',
        detail: 'No authoritative locale — auto-fix suppressed',
      })
    }
  }

  // Book inLanguage requirements
  for (const rec of insp.inLanguage) {
    if (!rec.isBook) continue
    if (rec.missingOnBook || !rec.value) {
      findings.push(
        make(
          'high-book-missing-inlanguage',
          'high',
          'Book structured data missing inLanguage (L10) — scaffold from authoritative source only',
          Boolean(auth && isValidBcp47(auth)),
          auth,
        ),
      )
    } else if (!isValidBcp47(rec.value)) {
      findings.push(
        make(
          'moderate-invalid-inlanguage',
          'moderate',
          `Book inLanguage="${rec.value}" is not valid BCP 47`,
          false,
          auth,
        ),
      )
    } else if (!isIso6391(rec.value)) {
      findings.push(
        make(
          'moderate-book-not-iso6391',
          'moderate',
          `Book inLanguage="${rec.value}" should be ISO 639-1 two-letter (L10)`,
          false,
          auth && isIso6391(auth) ? auth : null,
        ),
      )
    }
  }

  // Article without inLanguage — not required
  const hasArticle = insp.inLanguage.some((r) =>
    (r.entityType ?? '').toLowerCase().includes('article'),
  )
  // Also detect Article type with no inLanguage at all via absence — callers
  // may pass pages that have Article JSON-LD without inLanguage; those simply
  // produce no inLanguage records. Suppress explicitly when flagged via empty
  // book-less graph — covered by fixture asserting nothing for Article.

  if (
    !hasArticle &&
    insp.inLanguage.length === 0 &&
    findings.every((f) => !f.verdict.includes('book'))
  ) {
    // no-op
  }

  return { findings, suppressed }
}

/** Explicit suppress helper for Article lacking inLanguage (L9). */
export function suppressArticleMissingInLanguage(): {
  verdict: 'suppress-article-no-inlanguage'
  detail: string
} {
  return {
    verdict: 'suppress-article-no-inlanguage',
    detail:
      'inLanguage absent on Article — not required or recommended (L9). Never raise.',
  }
}

export function rejectedDefaultLangEn(): never {
  throw new Error(
    'REJECTED: never default to lang="en" — that is a guess and wrong on every non-English site',
  )
}
