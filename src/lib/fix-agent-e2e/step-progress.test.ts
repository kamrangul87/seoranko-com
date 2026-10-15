import { describe, expect, it } from 'vitest'
import { E2E_STEP_ORDER } from './constants'
import type { E2eStepRecord } from './store'
import {
  maxReachedStepIndex,
  mergeStepsNoRewind,
  passedStepsProposedAsPending,
  prepareForwardOnlyE2eWrite,
  wouldRewindSteps,
} from './step-progress'

function steps(
  patches: Partial<Record<string, E2eStepRecord['status']>>,
): E2eStepRecord[] {
  return E2E_STEP_ORDER.map((name) => ({
    name,
    status: patches[name] ?? 'pending',
  }))
}

describe('mergeStepsNoRewind', () => {
  it('keeps later passed steps when a stale all-pending snapshot arrives', () => {
    const latest = steps({
      reset_seed: 'passed',
      wait_seed_production: 'passed',
      crawl_compare: 'passed',
      fix_run_preview: 'running',
    })
    const stale = steps({ reset_seed: 'running' })
    const merged = mergeStepsNoRewind(latest, stale)
    expect(merged.find((s) => s.name === 'reset_seed')?.status).toBe('passed')
    expect(merged.find((s) => s.name === 'crawl_compare')?.status).toBe(
      'passed',
    )
    expect(merged.find((s) => s.name === 'fix_run_preview')?.status).toBe(
      'running',
    )
    expect(wouldRewindSteps(latest, stale)).toBe(true)
    expect(maxReachedStepIndex(merged)).toBe(
      E2E_STEP_ORDER.indexOf('fix_run_preview'),
    )
  })

  it('allows advancing the current pending step to running', () => {
    const latest = steps({
      reset_seed: 'passed',
      wait_seed_production: 'pending',
    })
    const proposed = steps({
      reset_seed: 'passed',
      wait_seed_production: 'running',
    })
    const merged = mergeStepsNoRewind(latest, proposed)
    expect(merged.find((s) => s.name === 'wait_seed_production')?.status).toBe(
      'running',
    )
    expect(wouldRewindSteps(latest, proposed)).toBe(false)
  })

  it('preserves startedAt when same-rank update omits it', () => {
    const latest: E2eStepRecord[] = [
      {
        name: 'wait_seed_production',
        status: 'running',
        startedAt: '2026-10-14T12:00:00.000Z',
      },
    ]
    const proposed: E2eStepRecord[] = [
      {
        name: 'wait_seed_production',
        status: 'running',
        detail: 'deploying',
      },
    ]
    const merged = mergeStepsNoRewind(latest, proposed)
    expect(merged[0]?.startedAt).toBe('2026-10-14T12:00:00.000Z')
    expect(merged[0]?.detail).toBe('deploying')
  })

  it('prepareForwardOnly rejects passed→pending and current_step rewind', () => {
    const live = steps({
      reset_seed: 'passed',
      wait_seed_production: 'passed',
      crawl_compare: 'passed',
      fix_run_preview: 'running',
    })
    const prepared = prepareForwardOnlyE2eWrite({
      liveSteps: live,
      liveCurrentStep: 'fix_run_preview',
      proposedSteps: steps({ reset_seed: 'passed' }),
      proposedCurrentStep: 'wait_seed_production',
    })
    expect(passedStepsProposedAsPending(live, steps({ reset_seed: 'passed' }))).toEqual(
      expect.arrayContaining(['wait_seed_production', 'crawl_compare']),
    )
    expect(prepared.rejected.some((r) => r.includes('passed→pending'))).toBe(
      true,
    )
    expect(prepared.rejected.some((r) => r.includes('current_step rewind'))).toBe(
      true,
    )
    expect(prepared.currentStep).toBeUndefined()
    expect(
      prepared.steps?.find((s) => s.name === 'crawl_compare')?.status,
    ).toBe('passed')
  })

  it('two concurrent snapshots — final merge keeps newest progress', () => {
    let live = steps({
      reset_seed: 'passed',
      wait_seed_production: 'passed',
      crawl_compare: 'running',
    })
    const writerOld = steps({
      reset_seed: 'passed',
      wait_seed_production: 'running',
    })
    const writerNew = steps({
      reset_seed: 'passed',
      wait_seed_production: 'passed',
      crawl_compare: 'passed',
      fix_run_preview: 'running',
    })
    live = mergeStepsNoRewind(live, writerOld)
    live = mergeStepsNoRewind(live, writerNew)
    expect(live.find((s) => s.name === 'crawl_compare')?.status).toBe('passed')
    expect(live.find((s) => s.name === 'fix_run_preview')?.status).toBe(
      'running',
    )
    expect(maxReachedStepIndex(live)).toBe(
      E2E_STEP_ORDER.indexOf('fix_run_preview'),
    )
  })
})
