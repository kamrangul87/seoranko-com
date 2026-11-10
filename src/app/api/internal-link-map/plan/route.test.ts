import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTODUN_LIKE_JOBS } from '@/lib/internal-link-map/autodun-like-html'
import {
  resetMemoryCrawlLinkEdges,
  useMemoryCrawlLinkEdges,
} from '@/lib/internal-link-map/persist'

const getUser = vi.fn()
const loadOwned = vi.fn()
const listRunsForSite = vi.fn()
const listJobsForRun = vi.fn()
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

vi.mock('@/lib/fix-strategies/findings-ui/crawl', () => ({
  getFindingsStore: () => ({
    listRunsForSite: (...args: unknown[]) => listRunsForSite(...args),
    listJobsForRun: (...args: unknown[]) => listJobsForRun(...args),
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

describe('POST /api/internal-link-map/plan', () => {
  beforeEach(() => {
    vi.resetModules()
    getUser.mockReset()
    loadOwned.mockReset()
    listRunsForSite.mockReset()
    listJobsForRun.mockReset()
    listEdges.mockReset()
    listSlim.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    resetMemoryCrawlLinkEdges()
    useMemoryCrawlLinkEdges()
  })

  it('returns 401 when there is no session', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/plan', {
        method: 'POST',
        body: JSON.stringify({ siteId: 'site-1' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('builds a reviewable plan from autodun-like stored HTML without applying anything', async () => {
    loadOwned.mockResolvedValue({
      id: 'site-1',
      domain: 'autodun.com',
      brand: null,
    })
    listRunsForSite.mockResolvedValue([
      {
        id: 'run-1',
        siteId: 'site-1',
        userId: 'user-1',
        origin: 'https://autodun.com',
        status: 'complete',
      },
    ])
    listEdges.mockResolvedValue([])
    listSlim.mockResolvedValue([])
    listJobsForRun.mockResolvedValue(
      AUTODUN_LIKE_JOBS.map((j) => ({
        url: j.url,
        status: j.status,
        httpStatus: j.httpStatus,
        finalUrl: j.finalUrl,
        html: j.html,
      })),
    )
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'site-1' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requiresApproval).toBe(true)
    expect(body.links.length).toBeGreaterThan(0)
    expect(
      body.links.every(
        (l: { sourceUrl: string; targetUrl: string }) => l.sourceUrl !== l.targetUrl,
      ),
    ).toBe(true)
    expect(body.clusters.some((c: { id: string }) => c.id === 'blog')).toBe(true)
    const sibling = body.links.find(
      (l: { kind: string; anchorText: string }) => l.kind === 'sibling',
    )
    expect(sibling?.anchorText).toMatch(/MOT Cost|MOT History/i)
    expect(
      body.links.some(
        (l: { sourceUrl: string; targetUrl: string }) =>
          l.sourceUrl === 'https://autodun.com/' &&
          l.targetUrl === 'https://autodun.com/about',
      ),
    ).toBe(false)
  })
})
