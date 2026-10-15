import { beforeEach, describe, expect, it, vi } from 'vitest'
import { E2E_STEP_ORDER } from './constants'
import type { E2eStepRecord } from './store'

type Row = {
  id: string
  steps: E2eStepRecord[]
  current_step: string
  updated_at: string
  status?: string
}

const state = vi.hoisted(() => ({
  row: null as null | Row,
  writes: 0,
}))

function chainableUpdate(patch: Record<string, unknown>) {
  const filters: Record<string, unknown> = {}
  const api = {
    eq(col: string, val: unknown) {
      filters[col] = val
      return api
    },
    select() {
      return {
        maybeSingle: async () => {
          if (!state.row) return { data: null, error: { message: 'missing' } }
          if (filters.id && filters.id !== state.row.id) {
            return { data: null, error: null }
          }
          if (
            filters.updated_at != null &&
            filters.updated_at !== state.row.updated_at
          ) {
            // CAS miss
            return { data: null, error: null }
          }
          state.writes += 1
          if (patch.steps) state.row.steps = patch.steps as E2eStepRecord[]
          if (patch.current_step !== undefined) {
            state.row.current_step = patch.current_step as string
          }
          if (patch.status) state.row.status = String(patch.status)
          if (patch.updated_at) state.row.updated_at = String(patch.updated_at)
          return { data: { ...state.row }, error: null }
        },
        single: async () => {
          const r = await api.select().maybeSingle()
          if (!r.data) return { data: null, error: { message: 'no row' } }
          return r
        },
      }
    },
  }
  return api
}

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
                  updated_at: state.row.updated_at,
                }
              : null,
            error: null,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => chainableUpdate(patch),
    }),
  }),
}))

function allPassedThrough(lastPassed: string): E2eStepRecord[] {
  const idx = E2E_STEP_ORDER.indexOf(
    lastPassed as (typeof E2E_STEP_ORDER)[number],
  )
  return E2E_STEP_ORDER.map((name, i) => ({
    name,
    status: i < idx ? 'passed' : i === idx ? 'passed' : 'pending',
  }))
}

describe('updateE2eRun forward-only CAS', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    state.writes = 0
    state.row = {
      id: 'e2e-1',
      current_step: 'recrawl_assert_closed',
      updated_at: '2026-10-15T09:00:00.000Z',
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { updateE2eRun } = await import('./store')
    const updated = await updateE2eRun('e2e-1', {
      current_step: 'wait_seed_production',
    })
    expect(updated.current_step).toBe('recrawl_assert_closed')
    expect(state.row!.current_step).toBe('recrawl_assert_closed')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('run=e2e-1'),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('rejected current_step rewind'),
    )
    warn.mockRestore()
  })

  it('rejects passed→pending in proposed steps (keeps passed)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { updateE2eRun } = await import('./store')
    const stale = E2E_STEP_ORDER.map((name) => ({
      name,
      status: 'pending' as const,
    }))
    stale[0]!.status = 'passed'
    await updateE2eRun('e2e-1', { steps: stale })
    expect(
      state.row!.steps.find((s) => s.name === 'crawl_compare')?.status,
    ).toBe('passed')
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/run=e2e-1.*passed→pending/),
    )
    warn.mockRestore()
  })

  it('two concurrent writers with old and new snapshots keep newest progress', async () => {
    const { updateE2eRun } = await import('./store')
    // Live is mid crawl_compare.
    state.row!.current_step = 'crawl_compare'
    state.row!.steps = allPassedThrough('wait_seed_production').map((s) =>
      s.name === 'crawl_compare' ? { ...s, status: 'running' } : s,
    )
    state.row!.updated_at = 't0'

    const oldSnapshot = allPassedThrough('reset_seed').map((s) =>
      s.name === 'wait_seed_production' ? { ...s, status: 'running' } : s,
    )
    const newSnapshot = allPassedThrough('crawl_compare').map((s) =>
      s.name === 'fix_run_preview' ? { ...s, status: 'running' } : s,
    )

    // Stale writer applies first.
    await updateE2eRun('e2e-1', {
      steps: oldSnapshot,
      current_step: 'wait_seed_production',
    })
    expect(state.row!.current_step).toBe('crawl_compare')
    expect(
      state.row!.steps.find((s) => s.name === 'crawl_compare')?.status,
    ).toBe('running')

    // Newer writer applies next — must keep/advance to fix_run_preview.
    await updateE2eRun('e2e-1', {
      steps: newSnapshot,
      current_step: 'fix_run_preview',
    })
    expect(state.row!.current_step).toBe('fix_run_preview')
    expect(
      state.row!.steps.find((s) => s.name === 'crawl_compare')?.status,
    ).toBe('passed')
    expect(
      state.row!.steps.find((s) => s.name === 'fix_run_preview')?.status,
    ).toBe('running')
  })
})
