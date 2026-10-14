import { describe, expect, it, beforeEach, vi } from 'vitest'

const activeRef: { current: { id: string; status: string } | null } = {
  current: null,
}

const runningListRef: {
  current: Array<{ id: string; status: string; started_at: string }>
} = { current: [] }

let failDuplicateAfterCreate = false

vi.mock('./store', async () => {
  const actual = await vi.importActual<typeof import('./store')>('./store')
  return {
    ...actual,
    getActiveE2eRun: async () => activeRef.current,
    listRunningE2eRuns: async () => {
      if (failDuplicateAfterCreate) {
        return [
          {
            id: 'older',
            status: 'running',
            started_at: '2026-10-14T12:00:00.000Z',
          },
          ...runningListRef.current,
        ]
      }
      return runningListRef.current
    },
    updateE2eRun: async (id: string, patch: { status?: string }) => {
      if (patch.status && patch.status !== 'running') {
        runningListRef.current = runningListRef.current.filter((r) => r.id !== id)
        if (activeRef.current?.id === id) activeRef.current = null
      }
      return { id, ...patch }
    },
    createE2eRun: async (input: { siteId: string; steps: unknown[] }) => {
      const row = {
        id: 'new-e2e',
        kind: 'fix_agent_fixture',
        status: 'running' as const,
        current_step: 'reset_seed',
        steps: input.steps,
        site_id: input.siteId,
        started_at: '2026-10-14T12:00:01.000Z',
      }
      activeRef.current = row
      runningListRef.current = [...runningListRef.current, row]
      return row
    },
  }
})

describe('startE2eRunIfIdle', () => {
  beforeEach(() => {
    activeRef.current = null
    runningListRef.current = []
    failDuplicateAfterCreate = false
  })

  it('refuses to start when another fix_agent_fixture run is still running', async () => {
    activeRef.current = { id: 'already', status: 'running' }
    runningListRef.current = [
      { id: 'already', status: 'running', started_at: '2026-10-14T12:00:00.000Z' },
    ]
    const { startE2eRunIfIdle } = await import('./runner')
    const result = await startE2eRunIfIdle()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/already running/i)
      expect(result.run.id).toBe('already')
    }
  })

  it('creates a new run when none is active', async () => {
    const { startE2eRunIfIdle } = await import('./runner')
    const result = await startE2eRunIfIdle()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.run.id).toBe('new-e2e')
      expect(result.created).toBe(true)
    }
  })

  it('fails a racing duplicate create and keeps the oldest run', async () => {
    failDuplicateAfterCreate = true
    const { startE2eRunIfIdle } = await import('./runner')
    const result = await startE2eRunIfIdle()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.run.id).toBe('older')
      expect(result.error).toMatch(/already running/i)
    }
  })
})
