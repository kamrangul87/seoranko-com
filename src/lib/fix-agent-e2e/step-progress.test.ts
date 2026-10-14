import { describe, expect, it } from 'vitest'
import { E2E_STEP_ORDER } from './constants'
import type { E2eStepRecord } from './store'
import {
  maxReachedStepIndex,
  mergeStepsNoRewind,
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
})
