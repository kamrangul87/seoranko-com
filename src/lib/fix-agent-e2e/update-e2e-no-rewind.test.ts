import { beforeEach, describe, expect, it, vi } from 'vitest'
import { E2E_STEP_ORDER } from './constants'
import type { E2eStepRecord } from './store'

const state = vi.hoisted(() => ({
  row: null as null | {
    id: string
    steps: E2eStepRecord[]
    current_step: string
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: state.row
              ? {
                  steps: state.row.steps,
                  current_step: state.row.current_step,
                }
              : null,
            error: null,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              if (!state.row) return { data: null, error: { message: 'missing' } }
              if (patch.steps) state.row.steps = patch.steps as E2eStepRecord[]
              if (patch.current_step !== undefined) {
                state.row.current_step = patch.current_step as string
              }
              return { data: { ...state.row }, error: null }
            },
          }),
        }),
      }),
    }),
  }),
}))

describe('updateE2eRun current_step-only no-rewind', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    state.row = {
      id: 'e2e-1',
      current_step: 'recrawl_assert_closed',
      steps: E2E_STEP_ORDER.map((name) => ({
        name,
        status:
          name === 'finalize' || name === 'recrawl_assert_closed'
            ? 'pending'
            : 'passed',
      })),
    }
  })

  it('does not rewind current_step when patch omits steps', async () => {
    const { updateE2eRun } = await import('./store')
    const updated = await updateE2eRun('e2e-1', {
      current_step: 'wait_seed_production',
    })
    expect(updated.current_step).toBe('recrawl_assert_closed')
    expect(state.row!.current_step).toBe('recrawl_assert_closed')
  })
})
