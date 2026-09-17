/**
 * In-memory fix-flow session for the Findings UI demo.
 * Commit is stubbed — fix-strategies CMS write path is not wired yet.
 */

import type { FixFlowState } from './types'

const g = globalThis as unknown as {
  __fixStrategiesFixFlow?: Map<string, FixFlowState>
}

function store(): Map<string, FixFlowState> {
  if (!g.__fixStrategiesFixFlow) {
    g.__fixStrategiesFixFlow = new Map()
  }
  return g.__fixStrategiesFixFlow
}

export function getFixFlow(findingId: string): FixFlowState {
  const existing = store().get(findingId)
  if (existing) return existing
  const fresh: FixFlowState = {
    findingId,
    step: 'idle',
    approvedAt: null,
    committedAt: null,
    commitStub: true,
    commitDetail: null,
    verifiedAt: null,
    verifyOk: null,
    verifyDetail: null,
  }
  store().set(findingId, fresh)
  return fresh
}

export function approveFix(findingId: string): FixFlowState {
  const s = getFixFlow(findingId)
  s.step = 'approved'
  s.approvedAt = new Date().toISOString()
  s.commitDetail = null
  s.verifyOk = null
  s.verifyDetail = null
  store().set(findingId, s)
  return s
}

/**
 * Stub commit — records intent. Real GitHub/CMS adapter not connected for
 * fix-strategies topics yet.
 */
export function commitFix(findingId: string, opts?: { diffSummary?: string }): FixFlowState {
  const s = getFixFlow(findingId)
  if (s.step !== 'approved' && s.step !== 'committed' && s.step !== 'verified') {
    s.step = 'failed'
    s.commitDetail = 'Approve before commit'
    store().set(findingId, s)
    return s
  }
  s.step = 'committed'
  s.committedAt = new Date().toISOString()
  s.commitStub = true
  s.commitDetail = opts?.diffSummary
    ? `STUB: would commit “${opts.diffSummary}” via site connector (not wired).`
    : 'STUB: would commit via site connector (not wired for fix-strategies yet).'
  store().set(findingId, s)
  return s
}

/**
 * Stub verify — simulates an independent live re-check.
 * Real verify-live.* modules exist per topic; wiring them needs a live URL
 * fetch after deploy. Demo returns a deterministic pass after commit.
 */
export function verifyFix(findingId: string): FixFlowState {
  const s = getFixFlow(findingId)
  if (s.step !== 'committed' && s.step !== 'verified') {
    s.step = 'failed'
    s.verifyOk = false
    s.verifyDetail = 'Commit before verify'
    store().set(findingId, s)
    return s
  }
  s.step = 'verified'
  s.verifiedAt = new Date().toISOString()
  s.verifyOk = true
  s.verifyDetail =
    'STUB verify: independent live re-crawl would call the topic verify-live module against the deployed URL. Demo marks verified after stub commit.'
  store().set(findingId, s)
  return s
}
