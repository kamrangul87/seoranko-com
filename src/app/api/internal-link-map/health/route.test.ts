import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const loadOwned = vi.fn()
const listRunsForSite = vi.fn()
const listJobsForRun = vi.fn()
const upsertFindings = vi.fn()
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
    upsertFindings: (...args: unknown[]) => upsertFindings(...args),
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

describe('GET/POST /api/internal-link-map/health', () => {
  beforeEach(() => {
    vi.resetModules()
    getUser.mockReset()
    loadOwned.mockReset()
    listRunsForSite.mockReset()
    listJobsForRun.mockReset()
    upsertFindings.mockReset()
    listEdges.mockReset()
    listSlim.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    loadOwned.mockResolvedValue({ id: 'site-1', domain: 'example.com', brand: null })
    listRunsForSite.mockResolvedValue([{ id: 'run-1', origin: 'https://example.com' }])
    listSlim.mockResolvedValue([])
    listJobsForRun.mockResolvedValue([
      {
        url: 'https://example.com/',
        status: 'crawled',
        httpStatus: 200,
        finalUrl: 'https://example.com/',
        html: `<html><body><main><article><h1>Home</h1><a href="/gone">click here</a></article></main></body></html>`,
      },
      {
        url: 'https://example.com/gone',
        status: 'failed',
        httpStatus: 404,
        finalUrl: null,
        html: null,
      },
    ])
    listEdges.mockResolvedValue([
      {
        sourceUrl: 'https://example.com/',
        targetUrl: 'https://example.com/gone',
        hrefRaw: '/gone',
        anchorText: 'click here',
        isNofollow: false,
        targetHttpStatus: 404,
        targetFinalUrl: null,
        isRedirect: false,
      },
    ])
  })

  it('lists crawl-edge health issues without applying a fix', async () => {
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map/health?siteId=site-1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.merged).toBe(false)
    expect(body.issues.some((i: { kind: string }) => i.kind === 'broken')).toBe(true)
    expect(body.issues.some((i: { kind: string }) => i.kind === 'generic-anchor')).toBe(true)
    expect(upsertFindings).not.toHaveBeenCalled()
  })

  it('queues mechanical issues for approval and never claims a merge', async () => {
    upsertFindings.mockResolvedValue(undefined)
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'site-1', action: 'queue' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.merged).toBe(false)
    expect(body.applied).toBe(false)
    expect(body.requiresApproval).toBe(true)
    expect(body.queued).toBeGreaterThan(0)
    expect(upsertFindings).toHaveBeenCalled()
    const findings = upsertFindings.mock.calls[0]![0].findings as Array<{
      evidenceValues: { neverAutoMerge?: boolean }
    }>
    expect(findings.every((f) => f.evidenceValues.neverAutoMerge === true)).toBe(true)
  })
})
