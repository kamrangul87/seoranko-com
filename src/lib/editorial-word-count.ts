/**
 * Phase 8 — editorial word-count targets (not Google SEO compliance).
 *
 * USER_TARGET / EDITORIAL_TARGET — never force filler to hit a number.
 */

export type WordCountTargetKind = 'USER_TARGET' | 'EDITORIAL_TARGET'

export type WordCountClassification =
  | 'WITHIN_PREFERRED'
  | 'ADVISORY'
  | 'CONTENT_COVERAGE'
  | 'OVER_MAXIMUM'

export interface EditorialWordCountTarget {
  kind: WordCountTargetKind
  /** User-selected or pipeline target. */
  preferred: number
  /** Soft minimum — below this may be ADVISORY or CONTENT_COVERAGE. */
  softMin: number
  /** Preferred band upper bound. */
  preferredMax: number
  /** Hard max only when the user/pipeline defines one. */
  absoluteMax: number | null
}

export interface WordCountAssessment {
  actual: number
  target: EditorialWordCountTarget
  classification: WordCountClassification
  /** Quality Gate severity contribution. */
  severity: 'warning' | 'info' | null
  title: string
  description: string
}

export function buildEditorialWordCountTarget(
  preferred: number,
  opts?: { absoluteMax?: number | null; kind?: WordCountTargetKind },
): EditorialWordCountTarget {
  const preferredClamped = Math.max(400, preferred)
  return {
    kind: opts?.kind ?? 'USER_TARGET',
    preferred: preferredClamped,
    softMin: Math.round(preferredClamped * 0.75),
    preferredMax: Math.round(preferredClamped * 1.12),
    absoluteMax: opts?.absoluteMax === undefined ? Math.round(preferredClamped * 1.25) : opts.absoluteMax,
  }
}

/**
 * Classify length vs editorial target.
 *
 * @param coverageIncomplete — true when brief/secondary-keyword/topic coverage
 *   already shows missing search-intent material (CONTENT_COVERAGE).
 */
export function assessEditorialWordCount(
  actual: number,
  preferred: number,
  opts?: {
    absoluteMax?: number | null
    coverageIncomplete?: boolean
    kind?: WordCountTargetKind
  },
): WordCountAssessment {
  const target = buildEditorialWordCountTarget(preferred, opts)
  const coverageIncomplete = opts?.coverageIncomplete === true

  if (target.absoluteMax != null && actual > target.absoluteMax) {
    return {
      actual,
      target,
      classification: 'OVER_MAXIMUM',
      severity: 'info',
      title: `Article is ${actual} words — above the editorial maximum (${target.absoluteMax})`,
      description: `Editorial target ${target.preferred} (max ${target.absoluteMax}). Trim repetition if it helps readers — this is not a Google ranking penalty by itself.`,
    }
  }

  if (actual >= target.softMin && actual <= target.preferredMax) {
    return {
      actual,
      target,
      classification: 'WITHIN_PREFERRED',
      severity: null,
      title: '',
      description: '',
    }
  }

  if (actual > target.preferredMax && (target.absoluteMax == null || actual <= target.absoluteMax)) {
    return {
      actual,
      target,
      classification: 'ADVISORY',
      severity: 'info',
      title: `Article is ${actual} words — slightly above the preferred editorial range`,
      description: `Preferred band ~${target.softMin}–${target.preferredMax} for target ${target.preferred}. Optional trim — do not cut useful coverage to hit a number.`,
    }
  }

  // Below soft min
  if (coverageIncomplete) {
    return {
      actual,
      target,
      classification: 'CONTENT_COVERAGE',
      severity: 'warning',
      title: `Article is ${actual} words and important search intent appears under-covered`,
      description: `Editorial target ${target.preferred} (soft min ${target.softMin}). Length alone is not the defect — expand missing entities/topics from the brief rather than adding filler.`,
    }
  }

  return {
    actual,
    target,
    classification: 'ADVISORY',
    severity: 'info',
    title: `Article is ${actual} words — below the editorial soft target (${target.softMin})`,
    description: `User/editorial target ${target.preferred}. If the piece is complete and useful, this is advisory only — never pad with filler to reach ${target.preferred}.`,
  }
}
