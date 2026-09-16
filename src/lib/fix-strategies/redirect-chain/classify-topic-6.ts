/**
 * Topic 6 — 302/307 where 301/308 belongs.
 *
 * Permanence CANNOT be inferred from the status code. Evidence required:
 * origin route absent from repo, 302 across separate crawls, or static config.
 * Always human-review — wrongly applied 301 is browser-cached.
 */

import type { ChainWalkResult } from './walk'

export type Topic6Verdict =
  | 'ok'
  | 'human-review-permanent-302'
  | 'suppress-no-permanence-evidence'
  | 'suppress-origin-still-exists'
  | 'suppress-genuine-temporary'
  | 'indeterminate-middleware'
  | 'route-topic-7-terminal-not-200'

export type PermanenceEvidence = {
  /** Origin route no longer in the repo (topic 70). */
  originAbsentFromRepo: boolean
  /** Same 302 observed across separate crawls. */
  observedAcrossCrawls: boolean
  /** Declared statically in next.config / vercel.json. */
  staticConfigDeclaration: boolean
}

export type ClassifyTopic6Input = {
  chain: ChainWalkResult
  evidence: PermanenceEvidence
  /** Origin route still exists in repo. */
  originRouteExists?: boolean
  /** Known temporary (maintenance, seasonal, A/B, geo). */
  genuineTemporary?: boolean
  middlewareIndeterminate?: boolean
}

export type ClassifyTopic6Result = {
  verdict: Topic6Verdict
  detail: string
  /** Always false — never auto-apply 301. */
  autoFixable: false
  temporaryStatuses: number[]
}

function isTemporary(status: number): boolean {
  return status === 302 || status === 307
}

function hasPermanenceEvidence(e: PermanenceEvidence): boolean {
  return (
    e.originAbsentFromRepo ||
    e.observedAcrossCrawls ||
    e.staticConfigDeclaration
  )
}

export function classifyTemporaryWherePermanent(
  input: ClassifyTopic6Input,
): ClassifyTopic6Result {
  const { chain } = input
  const temporaryStatuses = chain.hops
    .filter((h) => isTemporary(h.status))
    .map((h) => h.status)

  if (temporaryStatuses.length === 0) {
    return {
      verdict: 'ok',
      detail: 'No 302/307 hops',
      autoFixable: false,
      temporaryStatuses: [],
    }
  }

  // Terminal not 200 → topic 7 first
  if (
    chain.stoppedReason === 'non-3xx' &&
    chain.finalStatus !== 200 &&
    chain.redirectHopCount >= 1
  ) {
    return {
      verdict: 'route-topic-7-terminal-not-200',
      detail: 'Redirect target not 200 — topic 7 first',
      autoFixable: false,
      temporaryStatuses,
    }
  }

  if (input.genuineTemporary) {
    return {
      verdict: 'suppress-genuine-temporary',
      detail: 'Move is genuinely temporary — 302 is correct',
      autoFixable: false,
      temporaryStatuses,
    }
  }

  if (input.middlewareIndeterminate) {
    return {
      verdict: 'indeterminate-middleware',
      detail: '302/307 from middleware — indeterminate (topic 70)',
      autoFixable: false,
      temporaryStatuses,
    }
  }

  if (input.originRouteExists === true && !input.evidence.originAbsentFromRepo) {
    return {
      verdict: 'suppress-origin-still-exists',
      detail: 'Origin route still exists in repo — move may not be permanent',
      autoFixable: false,
      temporaryStatuses,
    }
  }

  if (!hasPermanenceEvidence(input.evidence)) {
    return {
      verdict: 'suppress-no-permanence-evidence',
      detail:
        'No permanence evidence (absent route / multi-crawl / static config) — do not raise; never infer from status alone',
      autoFixable: false,
      temporaryStatuses,
    }
  }

  const evidenceBits: string[] = []
  if (input.evidence.originAbsentFromRepo) evidenceBits.push('origin absent from repo')
  if (input.evidence.observedAcrossCrawls) evidenceBits.push('observed across crawls')
  if (input.evidence.staticConfigDeclaration) evidenceBits.push('static config declaration')

  return {
    verdict: 'human-review-permanent-302',
    detail: `302/307 with permanence evidence (${evidenceBits.join('; ')}) — propose 301/308; never auto-apply (browser-cached)`,
    autoFixable: false,
    temporaryStatuses,
  }
}
