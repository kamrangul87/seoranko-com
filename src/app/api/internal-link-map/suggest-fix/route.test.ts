import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const loadOwned = vi.fn()
const listRunsForSite = vi.fn()
const upsertFindings = vi.fn()

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
    upsertFindings: (...args: unknown[]) => upsertFindings(...args),
  }),
}))

vi.mock('@/lib/internal-link-map', () => ({
  loadOwnedConnectedSite: (...args: unknown[]) => loadOwned(...args),
}))

describe('POST /api/internal-link-map/suggest-fix', () => {
  beforeEach(() => {
    vi.resetModules()
    getUser.mockReset()
    loadOwned.mockReset()
    listRunsForSite.mockReset()
    upsertFindings.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    loadOwned.mockResolvedValue({ id: 'site-1', domain: 'example.com', brand: null })
    listRunsForSite.mockResolvedValue([{ id: 'run-1' }])
    upsertFindings.mockResolvedValue(undefined)
  })

  it('queues grouped sources as approval-required findings and never claims a merge', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      new Request('http://localhost/api/internal-link-map/suggest-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: 'site-1',
          links: [
            {
              sourceUrl: 'https://example.com/blog',
              href: '/blog/a',
              anchorText: 'A',
            },
            {
              sourceUrl: 'https://example.com/blog',
              href: '/blog/b',
              anchorText: 'B',
            },
            {
              sourceUrl: 'https://example.com/',
              href: '/about',
              anchorText: 'About Autodun',
            },
          ],
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      requiresApproval: true,
      applied: false,
      merged: false,
      findingCount: 2,
    })
    expect(upsertFindings).toHaveBeenCalledTimes(1)
    const arg = upsertFindings.mock.calls[0]![0] as {
      findings: Array<{ verdict: string; pageUrl: string }>
    }
    expect(arg.findings.every((f) => f.verdict === 'auto-add-related-articles')).toBe(
      true,
    )
    expect(arg.findings.map((f) => f.pageUrl).sort()).toEqual([
      'https://example.com/',
      'https://example.com/blog',
    ])
  })
})
