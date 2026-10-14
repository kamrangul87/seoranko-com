import { describe, expect, it, beforeEach, vi } from 'vitest'

const activeRef: { current: { id: string; status: string } | null } = {
  current: null,
}

vi.mock('./store', async () => {
  const actual = await vi.importActual<typeof import('./store')>('./store')
  return {
    ...actual,
    getActiveE2eRun: async () => activeRef.current,
    createE2eRun: async (input: { siteId: string; steps: unknown[] }) => {
      const row = {
        id: 'new-e2e',
        kind: 'fix_agent_fixture',
        status: 'running' as const,
        current_step: 'reset_seed',
        steps: input.steps,
        site_id: input.siteId,
      }
      activeRef.current = row
      return row
    },
  }
})

describe('startE2eRunIfIdle', () => {
  beforeEach(() => {
    activeRef.current = null
  })

  it('refuses to start when another fix_agent_fixture run is still running', async () => {
    activeRef.current = { id: 'already', status: 'running' }
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
})
