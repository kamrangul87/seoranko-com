/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/publisher-verification-runner.ts
// Phase B orchestrator — sweeps pages rows due for a liveness check, calls
// the provider-agnostic checkOnce(), and drives the state machine. This is
// the only place that promotes to LIVE_VERIFIED; nothing in Phase A does.
//
// BUILD_PENDING and LIVE_UNVERIFIED are both "not yet confirmed live, keep
// polling the real URL" from this module's point of view — the difference
// is just how many state-machine steps a VERIFIED result needs to take
// (BUILD_PENDING has no direct edge to LIVE_VERIFIED, so a page starting
// there takes two transitions: BUILD_READY then HTTP_VERIFIED).

import { checkOnce, computeBackoff } from './publisher-adapters/liveness-verifier'
import { transitionLiveness, appendLivenessHistory, type LivenessHistoryEntry, type LivenessEvent } from './publisher-adapters/liveness-state-machine'
import type { LivenessState } from './publisher-adapters/types'

export interface VerificationSweepResult {
  checked: number
  verified: number
  hardFailed: number
  stillPending: number
  skipped: number
  errors: string[]
}

interface DuePage {
  id: string
  article_id: string | null
  url: string | null
  liveness_state: LivenessState
  liveness_history: LivenessHistoryEntry[] | null
  verification_attempts: number
  first_check_at: string | null
  published_at: string | null
}

type CheckOutcome = 'verified' | 'hardFailed' | 'stillPending' | 'skipped'

// The actual per-page check-and-transition logic, shared by both entry
// points below so there's exactly one place that decides what "verified"
// means — runVerificationSweep and verifyOnePage must never be able to
// disagree about the outcome for the same row.
async function checkAndTransitionPage(supabase: any, page: DuePage, nowIso: string): Promise<{ outcome: CheckOutcome; error?: string }> {
  if (!page.url) return { outcome: 'skipped', error: `Page ${page.id} has no live URL to check.` }

  let contentMarker = ''
  if (page.article_id) {
    const { data: article } = await supabase.from('articles').select('title').eq('id', page.article_id).maybeSingle()
    contentMarker = article?.title || ''
  }
  if (!contentMarker) return { outcome: 'skipped', error: `Page ${page.id} has no linked article title to use as a content marker.` }

  const result = await checkOnce({ liveUrl: page.url, contentMarker, expectedCanonicalUrl: page.url })
  const attempts = page.verification_attempts + 1
  const firstCheckAt = page.first_check_at || page.published_at || nowIso
  const elapsedSeconds = Math.max(0, (Date.parse(nowIso) - Date.parse(firstCheckAt)) / 1000)
  const backoff = computeBackoff(attempts, elapsedSeconds)

  let history = page.liveness_history || []
  let finalState: LivenessState = page.liveness_state
  let nextCheckAt: string | null = null
  let outcome: CheckOutcome

  if (result.verdict === 'VERIFIED') {
    // BUILD_PENDING has no direct edge to LIVE_VERIFIED — take it in two
    // steps when starting from there.
    let state = page.liveness_state
    if (state === 'BUILD_PENDING') {
      const step1 = transitionLiveness(state, 'BUILD_READY')
      if (step1.ok) {
        history = appendLivenessHistory(history, { at: nowIso, event: 'BUILD_READY', from: step1.from, to: step1.to, detail: 'HTTP check succeeded — build is live.' })
        state = step1.to
      }
    }
    const step2 = transitionLiveness(state, 'HTTP_VERIFIED')
    finalState = step2.ok ? step2.to : state
    history = appendLivenessHistory(history, { at: nowIso, event: 'HTTP_VERIFIED', from: state, to: finalState, detail: result.detail })
    outcome = 'verified'
  } else if (result.verdict === 'HARD_FAILURE' || backoff.ceilingExceeded) {
    const event: LivenessEvent = page.liveness_state === 'BUILD_PENDING' ? 'BUILD_FAILED' : 'HTTP_VERIFICATION_HARD_FAILED'
    const transition = transitionLiveness(page.liveness_state, event)
    finalState = transition.ok ? transition.to : 'FAILED'
    const detail = backoff.ceilingExceeded && result.verdict !== 'HARD_FAILURE'
      ? `Retry ceiling exceeded (${Math.round(elapsedSeconds)}s elapsed) without the page going live. Last check: ${result.detail}`
      : result.detail
    history = appendLivenessHistory(history, { at: nowIso, event, from: page.liveness_state, to: finalState, detail })
    outcome = 'hardFailed'
  } else {
    // Still not live, still within the ceiling — reschedule, no state
    // transition (there's no "still pending" event; the state simply
    // doesn't change while we wait for the next check).
    nextCheckAt = new Date(Date.now() + backoff.nextDelaySeconds * 1000).toISOString()
    outcome = 'stillPending'
  }

  await supabase.from('pages').update({
    liveness_state: finalState,
    liveness_updated_at: nowIso,
    liveness_history: history,
    verification_attempts: attempts,
    first_check_at: firstCheckAt,
    next_check_at: nextCheckAt,
    updated_at: nowIso,
  }).eq('id', page.id)

  return { outcome }
}

export async function runVerificationSweep(supabase: any, options: { limit?: number } = {}): Promise<VerificationSweepResult> {
  const nowIso = new Date().toISOString()
  const summary: VerificationSweepResult = { checked: 0, verified: 0, hardFailed: 0, stillPending: 0, skipped: 0, errors: [] }

  const { data: duePages, error } = await supabase
    .from('pages')
    .select('id, article_id, url, liveness_state, liveness_history, verification_attempts, first_check_at, published_at')
    .in('liveness_state', ['BUILD_PENDING', 'LIVE_UNVERIFIED'])
    .or(`next_check_at.is.null,next_check_at.lte.${nowIso}`)
    .limit(options.limit ?? 25)

  if (error) {
    summary.errors.push(`Could not query due pages: ${error.message}`)
    return summary
  }

  for (const page of (duePages || []) as DuePage[]) {
    summary.checked++
    const { outcome, error: pageError } = await checkAndTransitionPage(supabase, page, nowIso)
    summary[outcome]++
    if (pageError) summary.errors.push(pageError)
  }

  return summary
}

// Verifies one specific page immediately, bypassing the "due" filter —
// used by the on-demand /api/publish/verify route so a client can poll
// faster than the cron sweep's interval for the first short backoff steps
// (30s/1m/2m), while runVerificationSweep remains the reliable long-tail
// fallback for the 5m/15m/30min-ceiling steps a client is unlikely to
// still be polling for. Calls the exact same per-page logic as the sweep
// (checkAndTransitionPage) directly — never delegates to the sweep query
// itself, which would risk picking up a different due row entirely under
// concurrent load.
export async function verifyOnePage(supabase: any, pageId: string, userId: string): Promise<{ success: boolean; message: string; liveness?: LivenessState }> {
  const { data: page } = await supabase
    .from('pages')
    .select('id, article_id, url, liveness_state, liveness_history, verification_attempts, first_check_at, published_at, user_id')
    .eq('id', pageId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!page) return { success: false, message: 'Page not found.' }
  if (!['BUILD_PENDING', 'LIVE_UNVERIFIED'].includes(page.liveness_state)) {
    return { success: true, message: `Nothing to verify — page is already ${page.liveness_state}.`, liveness: page.liveness_state }
  }

  const nowIso = new Date().toISOString()
  const { outcome, error } = await checkAndTransitionPage(supabase, page as DuePage, nowIso)
  const { data: updated } = await supabase.from('pages').select('liveness_state').eq('id', pageId).maybeSingle()

  return {
    success: outcome !== 'skipped',
    message: error || `Checked. Now ${updated?.liveness_state || page.liveness_state}.`,
    liveness: updated?.liveness_state,
  }
}
