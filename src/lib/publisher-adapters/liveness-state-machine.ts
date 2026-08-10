// src/lib/publisher-adapters/liveness-state-machine.ts
// Pure state-transition logic — no I/O, no platform knowledge. Every
// publish/verification module in this feature reads and writes through
// here so "what's a valid transition" lives in exactly one place.
//
// CREATED → PUBLISH_REQUESTED → BUILD_PENDING → LIVE_UNVERIFIED → LIVE_VERIFIED
//                              ↘_______________↗ (isLiveImmediately skips BUILD_PENDING)
// FAILED is reachable from any non-terminal state, and RETRY sends it back
// to PUBLISH_REQUESTED for a fresh attempt.

import type { LivenessState } from './types'

export type LivenessEvent =
  | 'PUBLISH_REQUESTED'
  | 'PUBLISH_SUCCEEDED_IMMEDIATE'   // -> LIVE_UNVERIFIED (isLiveImmediately)
  | 'PUBLISH_SUCCEEDED_DEFERRED'    // -> BUILD_PENDING (needs a rebuild/deploy)
  | 'PUBLISH_FAILED'
  | 'BUILD_READY'                   // BUILD_PENDING -> LIVE_UNVERIFIED
  | 'BUILD_FAILED'
  | 'HTTP_VERIFIED'                 // LIVE_UNVERIFIED -> LIVE_VERIFIED (Phase B only)
  | 'HTTP_VERIFICATION_HARD_FAILED' // LIVE_UNVERIFIED -> FAILED (404 past ceiling, wrong canonical)
  | 'RETRY'                         // FAILED -> PUBLISH_REQUESTED

const TRANSITIONS: Record<LivenessState, Partial<Record<LivenessEvent, LivenessState>>> = {
  CREATED: {
    PUBLISH_REQUESTED: 'PUBLISH_REQUESTED',
  },
  PUBLISH_REQUESTED: {
    PUBLISH_SUCCEEDED_IMMEDIATE: 'LIVE_UNVERIFIED',
    PUBLISH_SUCCEEDED_DEFERRED: 'BUILD_PENDING',
    PUBLISH_FAILED: 'FAILED',
  },
  BUILD_PENDING: {
    BUILD_READY: 'LIVE_UNVERIFIED',
    BUILD_FAILED: 'FAILED',
  },
  LIVE_UNVERIFIED: {
    HTTP_VERIFIED: 'LIVE_VERIFIED',
    HTTP_VERIFICATION_HARD_FAILED: 'FAILED',
  },
  LIVE_VERIFIED: {
    // Terminal in the happy path. A future re-verification failure (content
    // later removed) isn't modelled yet — out of scope for Phase A/B.
  },
  FAILED: {
    RETRY: 'PUBLISH_REQUESTED',
  },
}

export interface LivenessTransitionResult {
  ok: boolean
  from: LivenessState
  to: LivenessState
  event: LivenessEvent
  error?: string
}

export function transitionLiveness(current: LivenessState, event: LivenessEvent): LivenessTransitionResult {
  const next = TRANSITIONS[current]?.[event]
  if (!next) {
    return {
      ok: false,
      from: current,
      to: current,
      event,
      error: `Invalid liveness transition: ${event} is not allowed from ${current}.`,
    }
  }
  return { ok: true, from: current, to: next, event }
}

export interface LivenessHistoryEntry {
  at: string // ISO timestamp — caller supplies it (Date.now()/new Date() are unavailable in some execution contexts here, e.g. workflow scripts)
  event: LivenessEvent
  from: LivenessState
  to: LivenessState
  detail?: string
}

export function appendLivenessHistory(
  history: LivenessHistoryEntry[],
  entry: LivenessHistoryEntry,
): LivenessHistoryEntry[] {
  return [...history, entry]
}
