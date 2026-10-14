import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getFinding = vi.fn()
const listEvidenceForFinding = vi.fn()
const updateFindingSourceResolution = vi.fn()
const getFixFlow = vi.fn()
const isFixTypePaused = vi.fn()

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: () => undefined,
  }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => getUser(),
    },
  }),
}))

vi.mock('@/lib/fix-strategies/findings-ui/crawl', () => ({
  getFindingsStore: () => ({
    getFinding: (...args: unknown[]) => getFinding(...args),
    listEvidenceForFinding: (...args: unknown[]) =>
      listEvidenceForFinding(...args),
    updateFindingSourceResolution: (...args: unknown[]) =>
      updateFindingSourceResolution(...args),
  }),
}))

vi.mock('@/lib/fix-strategies/findings-ui/fix-flow-store', () => ({
  getFixFlow: (...args: unknown[]) => getFixFlow(...args),
}))

vi.mock('@/lib/fix-strategies/findings-ui/fix-run/failure-learning', () => ({
  isFixTypePaused: (...args: unknown[]) => isFixTypePaused(...args),
}))

vi.mock('@/lib/fix-strategies/findings-ui/map-persisted', () => ({
  persistedToUiFinding: (row: { id: string }) => ({ id: row.id, mapped: true }),
}))

describe('GET /api/fix-strategies/findings/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
    getUser.mockReset()
    getFinding.mockReset()
    listEvidenceForFinding.mockReset()
    updateFindingSourceResolution.mockReset()
    getFixFlow.mockReset()
    isFixTypePaused.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    getFixFlow.mockResolvedValue(null)
    isFixTypePaused.mockResolvedValue(false)
    listEvidenceForFinding.mockResolvedValue([])
  })

  it('rejects non-UUID ids with 400 (never hits the store / 500)', async () => {
    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/fix-strategies/findings/list'), {
      params: { id: 'list' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/uuid/i)
    expect(getFinding).not.toHaveBeenCalled()
    expect(updateFindingSourceResolution).not.toHaveBeenCalled()
  })

  it('GET never writes source resolution', async () => {
    const id = '1ee3e7f4-b43c-4d03-bc9a-a30128696595'
    getFinding.mockResolvedValue({
      id,
      userId: 'user-1',
      bucket: 'actionable',
      topicId: '26',
      verdict: 'human-review-canonical-elsewhere',
    })
    const { GET } = await import('./route')
    const res = await GET(new Request(`http://localhost/api/fix-strategies/findings/${id}`), {
      params: { id },
    })
    expect(res.status).toBe(200)
    expect(updateFindingSourceResolution).not.toHaveBeenCalled()
  })
})
