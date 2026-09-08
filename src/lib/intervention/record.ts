/**
 * Persist intervention_events from the Fix Agent verify loop.
 * lifecycle_state = verified only when an independent re-crawl state hash matches.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AutoFixKind } from '@/lib/fix-agent-classification'
import {
  classifySchemaChange,
  taxonomyForAutoFixKind,
  type TaxonomyEntry,
} from '@/lib/intervention/taxonomy'
import {
  diffPageStates,
  extractPageState,
  hashPageState,
  liveMatchesExpectedAfter,
  type InterventionPageState,
} from '@/lib/intervention/page-state'

export type InterventionLifecycleState =
  | 'recommended'
  | 'implemented'
  | 'verified'
  | 'measuring'
  | 'completed'
  | 'insufficient_data'
  | 'invalid'
  | 'interrupted'
  | 'implementation_failed'

export type RecordVerifiedInterventionInput = {
  supabase: any
  userId: string
  siteId: string
  url: string
  autoKind: AutoFixKind
  /** HTML before the write (from strategy). */
  beforeHtml: string
  /** HTML the adapter claims to have written. */
  expectedAfterHtml: string
  /** Independently re-fetched live HTML. */
  liveHtml: string
  liveStatusCode?: number | null
  experimentId?: string | null
  appliedAt?: string
  actor?: 'fix_agent' | 'user_confirmed' | 'deploy_detected'
}

export type RecordVerifiedInterventionResult = {
  recorded: boolean
  skippedReason?: string
  interventionId?: string | null
  lifecycleState?: InterventionLifecycleState
  beforeStateHash?: string
  afterStateHash?: string
  liveMatched?: boolean
  taxonomy?: TaxonomyEntry
}

function resolveTaxonomy(
  kind: AutoFixKind,
  before: InterventionPageState,
  after: InterventionPageState,
): TaxonomyEntry | null {
  if (
    kind === 'schema-organization' ||
    kind === 'schema-article' ||
    kind === 'schema-product' ||
    kind === 'schema-breadcrumb'
  ) {
    const change = classifySchemaChange(
      before.structured_data_types,
      after.structured_data_types,
    )
    return taxonomyForAutoFixKind(kind, { schemaChange: change || 'schema_added' })
  }
  return taxonomyForAutoFixKind(kind)
}

/**
 * Record an intervention after Fix Agent live verify.
 * - Hash match → lifecycle_state = verified
 * - Write succeeded but live hash mismatch → implemented (not verified)
 * - Unmapped auto-kind → skip (no detector in taxonomy yet)
 */
export async function recordInterventionFromVerify(
  input: RecordVerifiedInterventionInput,
): Promise<RecordVerifiedInterventionResult> {
  const beforeState = extractPageState(input.beforeHtml, { pageUrl: input.url })
  const expectedAfter = extractPageState(input.expectedAfterHtml, {
    pageUrl: input.url,
    statusCode: input.liveStatusCode ?? null,
  })
  const liveState = extractPageState(input.liveHtml, {
    pageUrl: input.url,
    statusCode: input.liveStatusCode ?? null,
  })

  // Prefer live status on expected for hash compare when both represent "after"
  const expectedForHash: InterventionPageState = {
    ...expectedAfter,
    status_code: liveState.status_code,
  }

  const taxonomy = resolveTaxonomy(input.autoKind, beforeState, expectedForHash)
  if (!taxonomy) {
    return { recorded: false, skippedReason: `no_taxonomy_for_${input.autoKind}` }
  }

  const liveMatched = liveMatchesExpectedAfter(
    expectedForHash,
    liveState,
    taxonomy.intervention_subtype,
  )
  const beforeStateHash = hashPageState(beforeState)
  const afterStateHash = hashPageState(liveMatched ? liveState : expectedForHash)
  const changeDiff = diffPageStates(beforeState, liveMatched ? liveState : expectedForHash)
  const appliedAt = input.appliedAt || new Date().toISOString()
  const lifecycleState: InterventionLifecycleState = liveMatched ? 'verified' : 'implemented'

  const row = {
    site_id: input.siteId,
    user_id: input.userId,
    experiment_id: input.experimentId ?? null,
    url_id: input.url,
    // Hosted stub from an earlier MCP apply had NOT NULL `url` (no url_id).
    // Keep both populated so inserts succeed against either shape.
    url: input.url,
    intervention_type: taxonomy.intervention_type,
    intervention_subtype: taxonomy.intervention_subtype,
    interference_scope: taxonomy.interference_scope,
    is_isolated: true,
    component_types: [] as string[],
    lifecycle_state: lifecycleState,
    actor: input.actor || 'fix_agent',
    applied_at: appliedAt,
    verified_at: liveMatched ? new Date().toISOString() : null,
    before_state_hash: beforeStateHash,
    after_state_hash: afterStateHash,
    before_state: beforeState,
    after_state: liveMatched ? liveState : expectedForHash,
    change_diff: changeDiff,
  }

  const { data, error } = await input.supabase
    .from('intervention_events')
    .insert(row)
    .select('id')
    .maybeSingle()

  if (error) {
    // Unique (url_id, intervention_type, applied_at) — surface without throwing into Fix Agent.
    console.error('[intervention] insert failed', error.message || error)
    return {
      recorded: false,
      skippedReason: error.message || 'insert_failed',
      liveMatched,
      beforeStateHash,
      afterStateHash,
      taxonomy,
      lifecycleState,
    }
  }

  return {
    recorded: true,
    interventionId: data?.id ?? null,
    lifecycleState,
    beforeStateHash,
    afterStateHash,
    liveMatched,
    taxonomy,
  }
}

/**
 * Pure gate used by tests: verified requires matching re-crawl hash.
 */
export function canMarkVerified(opts: {
  expectedAfter: InterventionPageState
  liveState: InterventionPageState
  subtype: string
}): boolean {
  return liveMatchesExpectedAfter(opts.expectedAfter, opts.liveState, opts.subtype)
}
