/**
 * Phase 10 — explainable Quality Gate score dimensions.
 *
 * score = deterministic aggregation of severity-weighted issues
 * (critical −20, warning −5). INFO / editorial advisory never dominate.
 *
 * Dimension membership: category map OR issue.affectsDimensions (authoritative
 * when present — prevents Freshness PASS while a currency claim is open).
 */

export type QualityDimensionId =
  | 'technical_seo'
  | 'structured_data'
  | 'factual_verification'
  | 'freshness'
  | 'readability'
  | 'internal_linking'
  | 'editorial'
  | 'core_web_vitals'

export type DimensionStatus = 'PASS' | 'REVIEW' | 'FAIL' | 'ADVISORY'

export type PublishDecision = 'READY' | 'NEEDS_REVIEW' | 'BLOCKED'

export interface DimensionResult {
  id: QualityDimensionId
  label: string
  status: DimensionStatus
  /** Issue ids that contributed to this dimension. */
  issueIds: string[]
  summary: string
}

export interface ExplainableScoreResult {
  dimensions: DimensionResult[]
  /** Deterministic: 100 − 20×critical − 5×warning (info ignored). */
  score: number
  scoreExplanation: string
  publishDecision: PublishDecision
  publishDecisionReason: string
}

type IssueLike = {
  id: string
  category: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  affectsDimensions?: QualityDimensionId[]
  blocking?: boolean
}

const DIMENSION_META: Record<QualityDimensionId, { label: string; categories: string[] }> = {
  technical_seo: {
    label: 'Technical SEO',
    categories: [
      'topic-alignment',
      'brand-mismatch',
      'missing-brand',
      'missing-author',
      'missing-date',
      'image-completeness',
      'image-placement',
      'heading-hierarchy',
      'heading-rhythm',
      'broken-citation-link',
      'score-floor',
    ],
  },
  structured_data: {
    label: 'Structured Data',
    categories: ['schema'],
  },
  factual_verification: {
    label: 'Factual Verification',
    categories: ['grant-figure', 'claim-evidence', 'fact-density'],
  },
  freshness: {
    label: 'Freshness',
    categories: ['dated-policy'],
  },
  readability: {
    label: 'Readability',
    categories: ['scannability', 'typo', 'merge-artifact', 'ai-slop', 'hedging', 'copy-error'],
  },
  internal_linking: {
    label: 'Internal Linking',
    categories: ['cross-brand-link'],
  },
  editorial: {
    label: 'Editorial',
    categories: ['word-count', 'brief-coverage', 'secondary-keyword-coverage'],
  },
  core_web_vitals: {
    label: 'Core Web Vitals',
    categories: ['core-web-vitals'],
  },
}

function statusFromIssues(issues: IssueLike[]): DimensionStatus {
  if (issues.some((i) => i.severity === 'critical')) return 'FAIL'
  if (issues.some((i) => i.severity === 'warning')) return 'REVIEW'
  if (issues.some((i) => i.severity === 'info')) return 'ADVISORY'
  return 'PASS'
}

function summaryFor(status: DimensionStatus, issues: IssueLike[]): string {
  if (status === 'PASS') return 'No open issues in this dimension.'
  if (status === 'ADVISORY') {
    return issues.map((i) => i.title).slice(0, 2).join('; ') || 'Editorial advisory only.'
  }
  const severe = issues.filter((i) => i.severity === 'critical' || i.severity === 'warning')
  return severe.map((i) => i.title).slice(0, 3).join('; ')
}

function issuesForDimension(id: QualityDimensionId, issues: IssueLike[]): IssueLike[] {
  const meta = DIMENSION_META[id]
  return issues.filter((i) => {
    // When present, affectsDimensions is the sole membership source — prevents
    // a Freshness-owned SUPPORTED advisory from also ADVISORY-ing Factual via
    // the grant-figure category map.
    if (i.affectsDimensions && i.affectsDimensions.length > 0) {
      return i.affectsDimensions.includes(id)
    }
    return meta.categories.includes(i.category)
  })
}

/**
 * Map issues → dimension board + explainable score + publish decision.
 * Editorial/info findings do not reduce the numeric score.
 */
export function buildExplainableScore(issues: IssueLike[]): ExplainableScoreResult {
  const criticalCount = issues.filter((i) => i.severity === 'critical').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const infoCount = issues.filter((i) => i.severity === 'info').length
  const score = Math.max(0, 100 - criticalCount * 20 - warningCount * 5)

  const dimensions: DimensionResult[] = (Object.keys(DIMENSION_META) as QualityDimensionId[]).map(
    (id) => {
      const dimIssues = issuesForDimension(id, issues)
      const status = statusFromIssues(dimIssues)
      return {
        id,
        label: DIMENSION_META[id].label,
        status,
        issueIds: dimIssues.map((i) => i.id),
        summary: summaryFor(status, dimIssues),
      }
    },
  )

  const scoreExplanation = [
    `Score ${score}/100 = 100 − (${criticalCount} critical × 20) − (${warningCount} warning × 5).`,
    infoCount > 0
      ? `${infoCount} advisory/info finding(s) listed but do not reduce the score.`
      : 'No advisory-only findings.',
  ].join(' ')

  const blockers = issues.filter(
    (i) =>
      i.blocking === true ||
      i.severity === 'critical' ||
      i.id === 'missing-brand' ||
      i.id === 'brand-mismatch' ||
      i.category === 'topic-alignment',
  )

  let publishDecision: PublishDecision
  let publishDecisionReason: string

  if (blockers.length > 0) {
    publishDecision = 'BLOCKED'
    const names = blockers
      .slice(0, 3)
      .map((i) => i.title)
      .join('; ')
    publishDecisionReason =
      blockers.length === 1
        ? `Blocked by: ${names}. Do not publish until this is resolved.`
        : `Blocked by ${blockers.length} issue(s): ${names}${blockers.length > 3 ? '…' : ''}. Do not publish until these are resolved.`
  } else if (warningCount > 0) {
    publishDecision = 'NEEDS_REVIEW'
    const warnTitles = issues
      .filter((i) => i.severity === 'warning')
      .slice(0, 2)
      .map((i) => i.title)
      .join('; ')
    publishDecisionReason = `${warningCount} warning(s) need human review before publish${
      warnTitles ? ` (${warnTitles})` : ''
    }. Advisory items do not block.`
  } else {
    publishDecision = 'READY'
    publishDecisionReason =
      infoCount > 0
        ? 'No critical/warning blockers. Editorial advisories may still be worth a skim.'
        : 'No open critical or warning issues.'
  }

  return {
    dimensions,
    score,
    scoreExplanation,
    publishDecision,
    publishDecisionReason,
  }
}

/** Human-readable board lines for logs / UI. */
export function formatDimensionBoard(result: ExplainableScoreResult): string[] {
  return result.dimensions.map((d) => `${d.label}: ${d.status}`)
}
