/**
 * Topic 13 — classify canonical absence / body-misplacement.
 */

export type Topic13Verdict =
  | 'ok'
  | 'informational-no-duplicates'
  | 'finding-absent-duplicates-proven'
  | 'finding-body-misplaced'
  | 'auto-add-self-canonical'
  | 'human-review-preferred-unresolved'
  | 'human-review-layout-cascade'
  | 'indeterminate-generateMetadata'
  | 'suppress-noindex'
  | 'suppress-header-present'
  | 'suppress-non-html'

export type Topic13Severity = 'informational' | 'finding' | null

export type ClassifyTopic13Input = {
  /** Zero head + zero header declarations. */
  absent: boolean
  /** Body has a canonical (C2 — counts as absent + own defect). */
  hasBodyMisplaced: boolean
  /** Header Link canonical present → not absent (topic 16 if HTML disagrees). */
  headerPresent: boolean
  /** Head has ≥1 canonical. */
  headPresent: boolean
  /** Topics 8–12 proved duplicate URL forms exist. */
  duplicatesProven: boolean
  /** Preferred form from topics 8–12, when known. */
  preferredForm: string | null
  /** Live response carries noindex. */
  hasNoindex: boolean
  /** Non-HTML resource (PDF, image). */
  isNonHtml: boolean
  /**
   * Repo declaration site for where a fix would land.
   * `'layout'` → never auto-fix (cascades).
   * `'generateMetadata-indeterminate'` → indeterminate.
   */
  repoSiteKind:
    | 'page'
    | 'layout'
    | 'generateMetadata-indeterminate'
    | 'none'
    | 'unknown'
}

export type ClassifyTopic13Result = {
  verdict: Topic13Verdict
  severity: Topic13Severity
  detail: string
  /**
   * When body-misplaced: topic 29 (non-metadata / tags outside head) is the
   * structural CAUSE. Report both — absent AND the cause routing.
   */
  causeTopic: 29 | null
  causeDetail: string | null
}

export function classifyCanonicalAbsent(
  input: ClassifyTopic13Input,
): ClassifyTopic13Result {
  // Body misplaced is always its own defect when present — even alongside a
  // valid head/header (Google disregards the body one; author intended one).
  // When ONLY body exists, treat as absent+misplaced AND route topic 29 cause.
  if (input.hasBodyMisplaced && !input.headPresent && !input.headerPresent) {
    if (input.hasNoindex) {
      return {
        verdict: 'suppress-noindex',
        severity: null,
        detail: 'Body canonical only, but page is noindex — canonical not required',
        causeTopic: 29,
        causeDetail:
          'Canonical landed in <body> (C2) — topic 29 explains structural cause; suppressed because noindex',
      }
    }
    return {
      verdict: 'finding-body-misplaced',
      severity: 'finding',
      detail:
        'Canonical only in <body> — Google disregards it (C2); counts as absent. Cause: topic 29 (non-metadata content / tags outside <head>)',
      causeTopic: 29,
      causeDetail:
        'Parser placed canonical in <body> (often after implicit </head> from non-metadata in head) — topic 29 owns the structural fix',
    }
  }

  if (input.hasBodyMisplaced && (input.headPresent || input.headerPresent)) {
    // Head/header present ⇒ not "absent"; body still a defect but topic 17
    // owns multi-declaration / misplaced alongside head. Topic 13 stays quiet
    // on absence; surface body note only when it is the sole declaration.
    return {
      verdict: 'ok',
      severity: null,
      detail:
        'Head/header canonical present — not absent; body duplicate is topic 17',
      causeTopic: null,
      causeDetail: null,
    }
  }

  if (input.headerPresent || input.headPresent) {
    return {
      verdict: input.headerPresent && !input.headPresent
        ? 'suppress-header-present'
        : 'ok',
      severity: null,
      detail: input.headerPresent && !input.headPresent
        ? 'HTTP Link canonical present — not absent (topic 16 if HTML disagrees)'
        : 'Head canonical present — not absent',
      causeTopic: null,
      causeDetail: null,
    }
  }

  // Truly absent (no head, no header, no body)
  if (input.hasNoindex) {
    return {
      verdict: 'suppress-noindex',
      severity: null,
      detail: 'Page is noindex — canonical not required (guard 4)',
      causeTopic: null,
      causeDetail: null,
    }
  }

  if (input.isNonHtml) {
    return {
      verdict: 'suppress-non-html',
      severity: null,
      detail: 'Non-HTML resource — HTML canonical fix does not apply (guard 6)',
      causeTopic: null,
      causeDetail: null,
    }
  }

  if (input.repoSiteKind === 'generateMetadata-indeterminate') {
    return {
      verdict: 'indeterminate-generateMetadata',
      severity: null,
      detail:
        'generateMetadata may set canonical conditionally — indeterminate (guard 3)',
      causeTopic: null,
      causeDetail: null,
    }
  }

  if (!input.duplicatesProven) {
    return {
      verdict: 'informational-no-duplicates',
      severity: 'informational',
      detail:
        'No canonical declared and no duplicate URL forms proven — informational only (guard 1)',
      causeTopic: null,
      causeDetail: null,
    }
  }

  // Duplicates proven — absence is a finding
  if (input.repoSiteKind === 'layout') {
    return {
      verdict: 'human-review-layout-cascade',
      severity: 'finding',
      detail:
        'Duplicates proven but fix would land in layout — never cascade (rejected)',
      causeTopic: null,
      causeDetail: null,
    }
  }

  if (!input.preferredForm) {
    return {
      verdict: 'human-review-preferred-unresolved',
      severity: 'finding',
      detail:
        'Duplicates proven, preferred form unresolved — human-review (topics 8–12)',
      causeTopic: null,
      causeDetail: null,
    }
  }

  if (input.repoSiteKind === 'page' || input.repoSiteKind === 'none') {
    return {
      verdict: 'auto-add-self-canonical',
      severity: 'finding',
      detail: `Duplicates proven — add self-referential canonical to ${input.preferredForm} on page file`,
      causeTopic: null,
      causeDetail: null,
    }
  }

  return {
    verdict: 'finding-absent-duplicates-proven',
    severity: 'finding',
    detail:
      'Duplicates proven, no canonical — declaration site unknown; human-review',
    causeTopic: null,
    causeDetail: null,
  }
}
