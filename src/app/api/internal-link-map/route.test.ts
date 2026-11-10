import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTODUN_LIKE_JOBS } from '@/lib/internal-link-map/autodun-like-html'
import {
  resetMemoryCrawlLinkEdges,
  useMemoryCrawlLinkEdges,
} from '@/lib/internal-link-map/persist'

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
    resetMemoryCrawlLinkEdges()
    useMemoryCrawlLinkEdges()
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

  it('rebuilds edges from stored autodun-like HTML when the run saved 0 links', async () => {
    loadOwned.mockResolvedValue({
      id: 'site-1',
      domain: 'autodun.com',
      brand: null,
    })
    listRunsForSite.mockResolvedValue([
      {
        id: 'run-empty',
        siteId: 'site-1',
        userId: 'user-1',
        origin: 'https://autodun.com',
        status: 'complete',
        isPartial: false,
        urlsFound: AUTODUN_LIKE_JOBS.length,
        urlsDiscovered: AUTODUN_LIKE_JOBS.length,
        urlsCrawled: AUTODUN_LIKE_JOBS.length,
        urlsFailed: 0,
        urlCap: null,
        chunkSize: 5,
        updatedAt: null,
        startedAt: null,
        finishedAt: null,
        errorDetail: null,
      },
    ])
    listSlim.mockResolvedValue(
      AUTODUN_LIKE_JOBS.map((j) => ({
        url: j.url,
        status: j.status,
        httpStatus: j.httpStatus,
        finalUrl: j.finalUrl,
      })),
    )
    listEdges.mockResolvedValue([])
    listJobsForRun.mockResolvedValue(
      AUTODUN_LIKE_JOBS.map((j) => ({
        url: j.url,
        status: j.status,
        httpStatus: j.httpStatus,
        finalUrl: j.finalUrl,
        html: j.html,
      })),
    )
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map?siteId=site-1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.graph.metrics.edgeCount).toBeGreaterThan(0)
    const about = body.graph.nodes.find((n: { path: string }) => n.path === '/about')
    expect(about?.kind).not.toBe('orphan')
    expect(about?.depth).toBe(1)
  })
})
