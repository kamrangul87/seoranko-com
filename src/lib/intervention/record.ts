/**
 * Persist intervention_events from the Fix Agent write + verify loop.
 *
 * - Successful adapter write → lifecycle_state = implemented (row created)
 * - Independent re-crawl state-hash match → promote to verified
 * Never trust the Fix Agent success report alone for verified.
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

export type RecordInterventionBase = {
  supabase: any
  userId: string
  siteId: string
  url: string
  autoKind: AutoFixKind
  beforeHtml: string
  expectedAfterHtml: string
  experimentId?: string | null
  appliedAt?: string
  actor?: 'fix_agent' | 'user_confirmed' | 'deploy_detected'
}

export type RecordImplementedInput = RecordInterventionBase

export type PromoteVerifiedInput = RecordInterventionBase & {
  interventionId: string
  liveHtml: string
  liveStatusCode?: number | null
}

/** @deprecated Prefer recordImplemented + promoteInterventionVerified */
export type RecordVerifiedInterventionInput = RecordInterventionBase & {
  liveHtml: string
  liveStatusCode?: number | null
}

export type RecordInterventionResult = {
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

function buildStates(input: {
  url: string
  beforeHtml: string
  expectedAfterHtml: string
  liveHtml?: string
  liveStatusCode?: number | null
}) {
  const beforeState = extractPageState(input.beforeHtml, { pageUrl: input.url })
  const expectedAfter = extractPageState(input.expectedAfterHtml, {
    pageUrl: input.url,
    statusCode: input.liveStatusCode ?? null,
  })
  const liveState = input.liveHtml
    ? extractPageState(input.liveHtml, {
        pageUrl: input.url,
        statusCode: input.liveStatusCode ?? null,
      })
    : null
  const expectedForHash: InterventionPageState = {
    ...expectedAfter,
    status_code: liveState?.status_code ?? expectedAfter.status_code,
  }
  return { beforeState, expectedAfter, liveState, expectedForHash }
}

/**
 * Insert intervention_events as implemented after a confirmed adapter write.
 */
export async function recordImplemented(
  input: RecordImplementedInput,
): Promise<RecordInterventionResult> {
  const { beforeState, expectedForHash } = buildStates(input)
  const taxonomy = resolveTaxonomy(input.autoKind, beforeState, expectedForHash)
  if (!taxonomy) {
    return { recorded: false, skippedReason: `no_taxonomy_for_${input.autoKind}` }
  }

  const beforeStateHash = hashPageState(beforeState)
  const afterStateHash = hashPageState(expectedForHash)
  const changeDiff = diffPageStates(beforeState, expectedForHash)
  const appliedAt = input.appliedAt || new Date().toISOString()

  let experimentId = input.experimentId ?? null
  if (!experimentId) {
    const { data: exp } = await input.supabase
      .from('experiments')
      .select('id')
      .eq('site_id', input.siteId)
      .in('status', ['baseline', 'ready', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    experimentId = exp?.id ?? null
  }

  const row = {
    site_id: input.siteId,
    user_id: input.userId,
    experiment_id: experimentId,
    url_id: input.url,
    url: input.url,
    intervention_type: taxonomy.intervention_type,
    intervention_subtype: taxonomy.intervention_subtype,
    interference_scope: taxonomy.interference_scope,
    is_isolated: true,
    component_types: [] as string[],
    lifecycle_state: 'implemented' as const,
    actor: input.actor || 'fix_agent',
    applied_at: appliedAt,
    verified_at: null,
    before_state_hash: beforeStateHash,
    after_state_hash: afterStateHash,
    before_state: beforeState,
    after_state: expectedForHash,
    change_diff: changeDiff,
  }

  const { data, error } = await input.supabase
    .from('intervention_events')
    .insert(row)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[intervention] implemented insert failed', error.message || error)
    return {
      recorded: false,
      skippedReason: error.message || 'insert_failed',
      beforeStateHash,
      afterStateHash,
      taxonomy,
      lifecycleState: 'implemented',
    }
  }

  return {
    recorded: true,
    interventionId: data?.id ?? null,
    lifecycleState: 'implemented',
    beforeStateHash,
    afterStateHash,
    taxonomy,
  }
}

/**
 * Promote an implemented intervention to verified when live re-crawl matches.
 */
export async function promoteInterventionVerified(
  input: PromoteVerifiedInput,
): Promise<RecordInterventionResult> {
  const { beforeState, expectedForHash, liveState } = buildStates(input)
  if (!liveState) {
    return { recorded: false, skippedReason: 'missing_live_html' }
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
  if (!liveMatched) {
    return {
      recorded: true,
      interventionId: input.interventionId,
      lifecycleState: 'implemented',
      liveMatched: false,
      taxonomy,
      beforeStateHash: hashPageState(beforeState),
      afterStateHash: hashPageState(expectedForHash),
    }
  }

  const afterStateHash = hashPageState(liveState)
  const beforeStateHash = hashPageState(beforeState)
  const { error } = await input.supabase
    .from('intervention_events')
    .update({
      lifecycle_state: 'verified',
      verified_at: new Date().toISOString(),
      after_state_hash: afterStateHash,
      after_state: liveState,
      change_diff: diffPageStates(beforeState, liveState),
    })
    .eq('id', input.interventionId)
    .eq('site_id', input.siteId)
    .eq('lifecycle_state', 'implemented')

  if (error) {
    console.error('[intervention] verify promote failed', error.message || error)
    return {
      recorded: false,
      skippedReason: error.message || 'promote_failed',
      interventionId: input.interventionId,
      liveMatched: true,
      taxonomy,
      beforeStateHash,
      afterStateHash,
    }
  }

  return {
    recorded: true,
    interventionId: input.interventionId,
    lifecycleState: 'verified',
    liveMatched: true,
    taxonomy,
    beforeStateHash,
    afterStateHash,
  }
}

/**
 * One-shot record used when write + live HTML are available together
 * (legacy path / backfill). Prefer recordImplemented + promoteInterventionVerified.
 */
export async function recordInterventionFromVerify(
  input: RecordVerifiedInterventionInput,
): Promise<RecordInterventionResult> {
  const implemented = await recordImplemented(input)
  if (!implemented.recorded || !implemented.interventionId) return implemented

  return promoteInterventionVerified({
    ...input,
    interventionId: implemented.interventionId,
  })
}

export function canMarkVerified(opts: {
  expectedAfter: InterventionPageState
  liveState: InterventionPageState
  subtype: string
}): boolean {
  return liveMatchesExpectedAfter(opts.expectedAfter, opts.liveState, opts.subtype)
}
