/**
 * Pure eligibility classifier for Fix Mission overview.
 * No I/O, no confidence scores, no customer writes.
 */

import { isTransformRegistered } from '@/lib/fix-strategies/findings-ui/fix-run/apply-registry'
import { dossierSlugForTopic } from '@/lib/fix-strategies/findings-ui/topic-registry'
import { isBlockedAutoMergePath } from '@/lib/fix-strategies/findings-ui/fix-flow/blast-radius'
import type {
  ClassifiableFinding,
  ClassifyFindingResult,
  ClassifySiteContext,
  SiteConnectorKind,
} from './types'

/** Transforms in apply-registry are GitHub Contents-API file edits only. */
const TRANSFORM_CONNECTOR: SiteConnectorKind = 'github'

export function findingCodeForTopic(topicId: string): string {
  return dossierSlugForTopic(topicId) ?? `topic-${topicId}`
}

export function strategyIdFor(topicId: string, verdict: string): string {
  return `${topicId}:${verdict}`
}

function isNotMechanicallyFixable(verdict: string): boolean {
  return (
    verdict === 'not_mechanically_fixable' ||
    verdict.startsWith('not_mechanically_fixable') ||
    verdict.startsWith('not-mechanically-fixable')
  )
}

function isHumanReviewVerdict(verdict: string): boolean {
  return verdict === 'human-review' || verdict.startsWith('human-review-')
}

function isAutoFixableVerdict(verdict: string, surfaceClass?: string | null): boolean {
  if (verdict.startsWith('auto-')) return true
  return surfaceClass === 'auto-fixable'
}

/**
 * Single-file change: one page/file scope, not a rolled-up shared component,
 * and not a site-wide config path when source_path is known.
 */
export function isSingleFileChange(finding: ClassifiableFinding): boolean {
  if (finding.affectedUrlCount > 1) return false
  if (finding.sourcePath && isBlockedAutoMergePath(finding.sourcePath)) {
    return false
  }
  return true
}

function transformExistsForConnector(
  topicId: string,
  verdict: string,
  connector: SiteConnectorKind,
): boolean {
  if (!isTransformRegistered(topicId, verdict)) return false
  return connector === TRANSFORM_CONNECTOR
}

/**
 * Classify one actionable finding for a site connector context.
 *
 * SAFE    = auto-fixable verdict AND transform for connector AND single-file
 * REVIEW  = human-review OR multi-file OR connector not connected
 * BLOCKED = not_mechanically_fixable OR no transform for connector
 */
export function classifyFinding(
  finding: ClassifiableFinding,
  site: ClassifySiteContext,
): ClassifyFindingResult {
  const findingCode = findingCodeForTopic(finding.topicId)
  const strategyId = isTransformRegistered(finding.topicId, finding.verdict)
    ? strategyIdFor(finding.topicId, finding.verdict)
    : null

  if (isNotMechanicallyFixable(finding.verdict)) {
    return {
      eligibility: 'blocked',
      reason: 'This issue cannot be fixed mechanically — it needs a different approach.',
      findingCode,
      strategyId: null,
    }
  }

  if (isHumanReviewVerdict(finding.verdict)) {
    return {
      eligibility: 'review',
      reason: 'This finding needs a human decision before any change.',
      findingCode,
      strategyId,
    }
  }

  const registered = isTransformRegistered(finding.topicId, finding.verdict)
  if (!registered) {
    return {
      eligibility: 'blocked',
      reason: 'No automatic fix is available for this issue yet.',
      findingCode,
      strategyId: null,
    }
  }

  // Transform exists in the GitHub registry, but site has no connector linked.
  if (!site.connected || site.connector == null) {
    return {
      eligibility: 'review',
      reason:
        'Connect a repository for this site before an automatic fix can run.',
      findingCode,
      strategyId,
    }
  }

  // Wrong connector type — no executable transform for this connector.
  if (!transformExistsForConnector(finding.topicId, finding.verdict, site.connector)) {
    return {
      eligibility: 'blocked',
      reason:
        'No automatic fix is available for this site’s connected platform yet.',
      findingCode,
      strategyId: null,
    }
  }

  if (!isSingleFileChange(finding)) {
    return {
      eligibility: 'review',
      reason:
        'This change would touch more than one file or a shared layout — review before applying.',
      findingCode,
      strategyId,
    }
  }

  if (!isAutoFixableVerdict(finding.verdict, finding.surfaceClass)) {
    return {
      eligibility: 'blocked',
      reason: 'No automatic fix is available for this issue yet.',
      findingCode,
      strategyId: null,
    }
  }

  return {
    eligibility: 'safe',
    reason: 'SEORANKO can apply a mechanical, single-file fix for this issue.',
    findingCode,
    strategyId,
  }
}
