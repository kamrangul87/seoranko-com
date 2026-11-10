import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const loadOwned = vi.fn()
const listFindings = vi.fn()
const getFinding = vi.fn()
const updateFindingSourceResolution = vi.fn()
const peekFixFlow = vi.fn()
const approveFix = vi.fn()
const commitFix = vi.fn()
const resetFixFlowToIdle = vi.fn()
const commitRelatedFindingsBatch = vi.fn()

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
    listFindings: (...args: unknown[]) => listFindings(...args),
    getFinding: (...args: unknown[]) => getFinding(...args),
    updateFindingSourceResolution: (...args: unknown[]) =>
      updateFindingSourceResolution(...args),
  }),
}))

vi.mock('@/lib/internal-link-map', async () => {
  const actual = await vi.importActual<typeof import('@/lib/internal-link-map')>(
    '@/lib/internal-link-map',
  )
  return {
    ...actual,
    loadOwnedConnectedSite: (...args: unknown[]) => loadOwned(...args),
  }
})

vi.mock('@/lib/fix-strategies/findings-ui/fix-flow/persist', () => ({
  peekFixFlow: (...args: unknown[]) => peekFixFlow(...args),
  resetFixFlowToIdle: (...args: unknown[]) => resetFixFlowToIdle(...args),
}))

vi.mock('@/lib/fix-strategies/findings-ui/fix-flow-store', () => ({
  approveFix: (...args: unknown[]) => approveFix(...args),
  commitFix: (...args: unknown[]) => commitFix(...args),
}))

vi.mock('@/lib/fix-strategies/findings-ui/fix-flow/commit-related-batch', () => ({
  commitRelatedFindingsBatch: (...args: unknown[]) =>
    commitRelatedFindingsBatch(...args),
}))

function relatedRow(id = '11111111-1111-4111-8111-111111111111') {
  return {
    id,
    siteId: 'site-1',
    userId: 'user-1',
    topicId: 'related',
    kind: 'internal-links/related-articles',
    verdict: 'auto-add-related-articles',
    bucket: 'actionable',
    pageUrl: 'https://example.com/blog/a.html',
    detail: 'Add related reading links',
    status: 'open',
    fixedAt: null,
    evidenceValues: {
      relatedTargets: [{ href: '/blog/b.html', anchorText: 'B' }],
      requiresApproval: true,
      neverAutoMerge: true,
    },
    proposedDiff: { proposed: { relatedTargets: [{ href: '/blog/b.html', anchorText: 'B' }] } },
    sourcePath: null,
    sourceBlobSha: null,
    sourceResolvedAt: null,
    sourceUnresolvedReason: null,
    autoFixable: true,
    surfaceClass: 'finding',
  }
}

describe('GET /api/internal-link-map/approvals', () => {
  beforeEach(() => {
    vi.resetModules()
    getUser.mockReset()
    loadOwned.mockReset()
    listFindings.mockReset()
    getFinding.mockReset()
    updateFindingSourceResolution.mockReset()
    peekFixFlow.mockReset()
    approveFix.mockReset()
    commitFix.mockReset()
    resetFixFlowToIdle.mockReset()
    commitRelatedFindingsBatch.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    peekFixFlow.mockResolvedValue(null)
    listFindings.mockResolvedValue([relatedRow()])
  })

  it('returns 401 when there is no session', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map/approvals?siteId=site-1'),
    )
    expect(res.status).toBe(401)
    expect(loadOwned).not.toHaveBeenCalled()
  })

  it('returns 404 when the site is not owned by the caller', async () => {
    loadOwned.mockResolvedValue(null)
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map/approvals?siteId=site-1'),
    )
    expect(res.status).toBe(404)
    expect(listFindings).not.toHaveBeenCalled()
  })

  it('lists related reading findings for an owned site and never claims a merge', async () => {
    loadOwned.mockResolvedValue({
      id: 'site-1',
      domain: 'example.com',
      brand: null,
    })
    listFindings.mockResolvedValue([
      relatedRow(),
      {
        ...relatedRow('22222222-2222-4222-8222-222222222222'),
        topicId: '43',
        verdict: 'orphan-page',
      },
    ])
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map/approvals?siteId=site-1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'pending',
      neverAutoMerge: true,
    })
    expect(body.merged).toBe(false)
    expect(approveFix).not.toHaveBeenCalled()
    expect(commitFix).not.toHaveBeenCalled()
  })

  it('sorts strongest relevance first and exposes score and reason', async () => {
    loadOwned.mockResolvedValue({
      id: 'site-1',
      domain: 'example.com',
      brand: null,
    })
    listFindings.mockResolvedValue([
      {
        ...relatedRow('33333333-3333-4333-8333-333333333333'),
        evidenceValues: {
          relatedTargets: [
            {
              href: '/weak',
              anchorText: 'Weak',
              score: 0.3,
              reason: 'Loose overlap — weak match',
              weakMatch: true,
            },
          ],
          neverAutoMerge: true,
        },
      },
      {
        ...relatedRow(),
        evidenceValues: {
          relatedTargets: [
            {
              href: '/strong',
              anchorText: 'Strong',
              score: 0.91,
              reason: 'Both pages cover MOT tests',
            },
          ],
          neverAutoMerge: true,
        },
      },
    ])
    const { GET } = await import('./route')
    const res = await GET(
      new Request('http://localhost/api/internal-link-map/approvals?siteId=site-1'),
    )
    const body = await res.json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ])
    expect(body.items[0]).toMatchObject({
      score: 0.91,
      reason: 'Both pages cover MOT tests',
      weakMatch: false,
    })
    expect(body.items[1].weakMatch).toBe(true)
  })
})

describe('POST /api/internal-link-map/approvals', () => {
  beforeEach(() => {
    vi.resetModules()
    getUser.mockReset()
    loadOwned.mockReset()
    listFindings.mockReset()
    getFinding.mockReset()
    updateFindingSourceResolution.mockReset()
    peekFixFlow.mockReset()
    approveFix.mockReset()
    commitFix.mockReset()
    resetFixFlowToIdle.mockReset()
    commitRelatedFindingsBatch.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    loadOwned.mockResolvedValue({
      id: 'site-1',
      domain: 'example.com',
      brand: null,
    })
    peekFixFlow.mockResolvedValue(null)
    getFinding.mockResolvedValue(relatedRow())
    updateFindingSourceResolution.mockResolvedValue(undefined)
  })

  it('returns 401 when there is no session', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: 'site-1',
          findingId: '11111111-1111-4111-8111-111111111111',
          action: 'reject',
        }),
      }),
    )
    expect(res.status).toBe(401)
    expect(updateFindingSourceResolution).not.toHaveBeenCalled()
  })

  it('returns 404 when the finding is not owned by the caller', async () => {
    getFinding.mockResolvedValue({
      ...relatedRow(),
      userId: 'someone-else',
      siteId: 'site-other',
    })
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: 'site-1',
          findingId: '11111111-1111-4111-8111-111111111111',
          action: 'reject',
        }),
      }),
    )
    expect(res.status).toBe(404)
    expect(updateFindingSourceResolution).not.toHaveBeenCalled()
    expect(approveFix).not.toHaveBeenCalled()
  })

  it('rejects a pending related finding without opening a PR', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: 'site-1',
          findingId: '11111111-1111-4111-8111-111111111111',
          action: 'reject',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.status).toBe('rejected')
    expect(body.merged).toBe(false)
    expect(updateFindingSourceResolution).toHaveBeenCalled()
    expect(approveFix).not.toHaveBeenCalled()
    expect(commitFix).not.toHaveBeenCalled()
  })

  it('opens one shared PR for approve-batch and never auto-merges', async () => {
    const a = relatedRow()
    const b = relatedRow('22222222-2222-4222-8222-222222222222')
    getFinding.mockImplementation(async (id: string) =>
      id === a.id ? a : id === b.id ? b : null,
    )
    commitRelatedFindingsBatch.mockResolvedValue({
      ok: true,
      prUrl: 'https://github.com/ex/repo/pull/12',
      prNumber: 12,
      items: [
        { id: a.id, ok: true, prUrl: 'https://github.com/ex/repo/pull/12' },
        { id: b.id, ok: true, prUrl: 'https://github.com/ex/repo/pull/12' },
      ],
      merged: false,
    })
    peekFixFlow.mockResolvedValue({
      step: 'committed',
      prUrl: 'https://github.com/ex/repo/pull/12',
      prNumber: 12,
      mergedAt: null,
    })
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: 'site-1',
          findingIds: [a.id, b.id],
          action: 'approve-batch',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.merged).toBe(false)
    expect(body.prUrl).toBe('https://github.com/ex/repo/pull/12')
    expect(body.items).toHaveLength(2)
    expect(
      body.items.every((item: { prUrl: string }) => item.prUrl === body.prUrl),
    ).toBe(true)
    expect(commitFix).not.toHaveBeenCalled()
    expect(commitRelatedFindingsBatch).toHaveBeenCalledTimes(1)
  })

  it('resets an old-transform finding to pending without closing the GitHub PR', async () => {
    getFinding.mockResolvedValue({
      ...relatedRow(),
      evidenceValues: {
        relatedTargets: [{ href: '/blog/b.html', anchorText: 'EV charging' }],
        requiresApproval: true,
        neverAutoMerge: true,
      },
    })
    peekFixFlow
      .mockResolvedValueOnce({
        step: 'committed',
        prUrl: 'https://github.com/autodun-ai/autodun.com/pull/73',
        prNumber: 73,
        mergedAt: null,
      })
      .mockResolvedValueOnce({
        step: 'idle',
        prUrl: null,
        prNumber: null,
        mergedAt: null,
      })
    resetFixFlowToIdle.mockResolvedValue({
      step: 'idle',
      prUrl: null,
      prNumber: null,
    })
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: 'site-1',
          findingId: '11111111-1111-4111-8111-111111111111',
          action: 'regenerate',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.status).toBe('pending')
    expect(body.closedGithubPr).toBe(false)
    expect(body.merged).toBe(false)
    expect(resetFixFlowToIdle).toHaveBeenCalledTimes(1)
    expect(commitFix).not.toHaveBeenCalled()
  })
})
