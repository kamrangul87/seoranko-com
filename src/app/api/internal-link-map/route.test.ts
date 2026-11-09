import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const loadOwned = vi.fn()
const listRunsForSite = vi.fn()
const listRunsForDetectOrigin = vi.fn()
const listJobsForRun = vi.fn()
const failAbandoned = vi.fn()
const listEdges = vi.fn()
const listSlim = vi.fn()

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
}))

vi.mock('@/lib/supabase/ssr-client', () => ({
  createSupabaseSsrClient: () => ({
    auth: { getUser: () => getUser() },
  }),
}))

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/fix-strategies/findings-ui/crawl', () => ({
  CRAWL_URL_CHUNK_SIZE: 5,
  failAbandonedCrawlRuns: (...args: unknown[]) => failAbandoned(...args),
  getFindingsStore: () => ({
    listRunsForSite: (...args: unknown[]) => listRunsForSite(...args),
    listRunsForDetectOrigin: (...args: unknown[]) =>
      listRunsForDetectOrigin(...args),
    listJobsForRun: (...args: unknown[]) => listJobsForRun(...args),
    listFindings: async () => [],
  }),
}))

vi.mock('@/lib/internal-link-map', async () => {
  const actual = await vi.importActual<typeof import('@/lib/internal-link-map')>(
    '@/lib/internal-link-map',
  )
  return {
    ...actual,
    loadOwnedConnectedSite: (...args: unknown[]) => loadOwned(...args),
    listCrawlLinkEdges: (...args: unknown[]) => listEdges(...args),
    listSlimCrawlJobs: (...args: unknown[]) => listSlim(...args),
  }
})

describe('GET /api/internal-link-map', () => {
  beforeEach(() => {
    vi.resetModules()
    getUser.mockReset()
    loadOwned.mockReset()
    listRunsForSite.mockReset()
    listRunsForDetectOrigin.mockReset()
    listJobsForRun.mockReset()
    failAbandoned.mockReset()
    listEdges.mockReset()
    listSlim.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    failAbandoned.mockResolvedValue(undefined)
    listEdges.mockResolvedValue([])
    listSlim.mockResolvedValue([])
    listJobsForRun.mockResolvedValue([])
    listRunsForSite.mockResolvedValue([])
  })

  it('returns 401 when there is no session', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map?siteId=site-1'),
    )
    expect(res.status).toBe(401)
    expect(loadOwned).not.toHaveBeenCalled()
  })

  it('returns 404 when the site is not owned by the caller', async () => {
    loadOwned.mockResolvedValue(null)
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map?siteId=site-1'),
    )
    expect(res.status).toBe(404)
    expect(listRunsForSite).not.toHaveBeenCalled()
  })

  it('returns an empty graph payload when the owned site has no crawl yet', async () => {
    loadOwned.mockResolvedValue({
      id: 'site-1',
      domain: 'example.com',
      brand: null,
    })
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map?siteId=site-1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.graph).toBeNull()
    expect(body.crawl).toBeNull()
    expect(loadOwned).toHaveBeenCalled()
  })
})
