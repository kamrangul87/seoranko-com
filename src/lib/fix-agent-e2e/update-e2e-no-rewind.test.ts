import { beforeEach, describe, expect, it, vi } from 'vitest'
import { E2E_STEP_ORDER } from './constants'
import type { E2eStepRecord } from './store'

type Row = {
  id: string
  steps: E2eStepRecord[]
  current_step: string
  updated_at: string
  write_version: number
  status?: string
  seed_sha?: string | null
}

const state = vi.hoisted(() => ({
  row: null as null | Row,
  writes: 0,
  /** Force N CAS misses before allowing a write (simulates concurrent writer). */
  forceCasMisses: 0,
  selectCalls: 0,
  fetchOpts: null as null | typeof fetch,
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
          if (state.forceCasMisses > 0) {
            state.forceCasMisses -= 1
            // Simulate concurrent writer bumping the version between read and write.
            state.row.write_version += 1
            state.row.updated_at = `t-cas-${state.row.write_version}`
            return { data: null, error: null }
          }
          if (
            filters.write_version != null &&
            filters.write_version !== state.row.write_version
          ) {
            return { data: null, error: null }
          }
          if (
            filters.updated_at != null &&
            filters.write_version == null &&
            filters.updated_at !== state.row.updated_at
          ) {
            return { data: null, error: null }
          }
          state.writes += 1
          if (patch.steps) state.row.steps = patch.steps as E2eStepRecord[]
          if (patch.current_step !== undefined) {
            state.row.current_step = patch.current_step as string
          }
          if (patch.status) state.row.status = String(patch.status)
          if (patch.seed_sha !== undefined) {
            state.row.seed_sha = patch.seed_sha as string | null
          }
          if (patch.updated_at) state.row.updated_at = String(patch.updated_at)
          if (typeof patch.write_version === 'number') {
            state.row.write_version = patch.write_version
          } else {
            state.row.write_version += 1
          }
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
  createClient: (_url?: string, _key?: string, opts?: { global?: { fetch?: typeof fetch } }) => {
    // Ensure the no-store fetch wrapper is installed (Next.js GET cache bust).
    if (opts?.global?.fetch) {
      state.fetchOpts = opts.global.fetch
    }
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              state.selectCalls += 1
              return {
                data: state.row
                  ? {
                      ...state.row,
                      steps: state.row.steps,
                      current_step: state.row.current_step,
                      updated_at: state.row.updated_at,
                      write_version: state.row.write_version,
                      seed_sha: state.row.seed_sha ?? null,
                    }
                  : null,
                error: null,
              }
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => chainableUpdate(patch),
      }),
    }
  },
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
    state.forceCasMisses = 0
    state.selectCalls = 0
    state.fetchOpts = null
    state.row = {
      id: 'e2e-1',
      current_step: 'recrawl_assert_closed',
      updated_at: '2026-10-15T09:00:00.000Z',
      write_version: 1,
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
    state.row!.write_version = 3

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

  it('installs no-store fetch so CAS retries do not read a stale write_version', async () => {
    const { updateE2eRun } = await import('./store')
    await updateE2eRun('e2e-1', { current_step: 'finalize' })
    expect(state.fetchOpts).toBeTypeOf('function')
    const fakeReq = {
      url: 'https://example.supabase.co/rest/v1/e2e_runs',
    } as unknown as RequestInfo
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }),
    )
    await state.fetchOpts!(fakeReq, { method: 'GET' })
    expect(spy).toHaveBeenCalled()
    const init = spy.mock.calls[0]?.[1] as RequestInit & { cache?: string }
    expect(init?.cache).toBe('no-store')
    spy.mockRestore()
  })

  it('parseWriteVersion accepts PostgREST number or numeric string', async () => {
    const { parseWriteVersion } = await import('./store')
    expect(parseWriteVersion(0)).toBe(0)
    expect(parseWriteVersion(12)).toBe(12)
    expect(parseWriteVersion('7')).toBe(7)
    expect(parseWriteVersion(undefined)).toBeNull()
    expect(parseWriteVersion('nope')).toBeNull()
  })

  it('legitimate forward write (reset_seed→passed) succeeds after CAS conflict retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { updateE2eRun } = await import('./store')

    state.row!.current_step = 'reset_seed'
    state.row!.write_version = 10
    state.row!.updated_at = '2026-10-15T09:33:26.123456+00:00'
    state.row!.steps = E2E_STEP_ORDER.map((name) => ({
      name,
      status: name === 'reset_seed' ? 'running' : 'pending',
      ...(name === 'reset_seed'
        ? { startedAt: '2026-10-15T09:33:26.209Z' }
        : {}),
    }))
    // First write attempt CAS-misses (simulates fragile updated_at / concurrent bump).
    state.forceCasMisses = 1

    const forwardSteps = E2E_STEP_ORDER.map((name) => ({
      name,
      status:
        name === 'reset_seed'
          ? ('passed' as const)
          : name === 'wait_seed_production'
            ? ('pending' as const)
            : ('pending' as const),
      ...(name === 'reset_seed'
        ? {
            startedAt: '2026-10-15T09:33:26.209Z',
            finishedAt: '2026-10-15T09:33:31.000Z',
            detail: 'reset-commit 363859a',
          }
        : {}),
    }))

    const updated = await updateE2eRun('e2e-1', {
      steps: forwardSteps,
      current_step: 'wait_seed_production',
      seed_sha: '363859abcdef',
    })

    expect(updated.current_step).toBe('wait_seed_production')
    expect(state.row!.current_step).toBe('wait_seed_production')
    expect(state.row!.seed_sha).toBe('363859abcdef')
    expect(
      state.row!.steps.find((s) => s.name === 'reset_seed')?.status,
    ).toBe('passed')
    expect(state.writes).toBeGreaterThanOrEqual(1)
    expect(state.selectCalls).toBeGreaterThanOrEqual(2)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/cas_conflict/),
    )
    warn.mockRestore()
  })

  it('returns live row when concurrent writer already applied the same forward patch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { updateE2eRun, liveSatisfiesForwardPatch } = await import('./store')

    const passedSteps = E2E_STEP_ORDER.map((name) => ({
      name,
      status:
        name === 'reset_seed'
          ? ('passed' as const)
          : ('pending' as const),
    }))

    // Live already advanced (other tick won the race).
    state.row!.current_step = 'wait_seed_production'
    state.row!.write_version = 5
    state.row!.seed_sha = 'abc123'
    state.row!.steps = passedSteps

    expect(
      liveSatisfiesForwardPatch(state.row as never, {
        steps: passedSteps,
        current_step: 'wait_seed_production',
        seed_sha: 'abc123',
      }),
    ).toBe(true)

    const beforeWrites = state.writes
    const updated = await updateE2eRun('e2e-1', {
      steps: passedSteps,
      current_step: 'wait_seed_production',
      seed_sha: 'abc123',
    })
    expect(updated.current_step).toBe('wait_seed_production')
    expect(updated.seed_sha).toBe('abc123')
    // No write needed — already satisfied.
    expect(state.writes).toBe(beforeWrites)
    warn.mockRestore()
  })
})
