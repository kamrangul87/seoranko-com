import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// This route's own recipient query targets a table ("profiles") that does
// not exist in production, so it has never actually reached the Resend
// call in real usage — see the PR for the live-DB evidence. These tests
// prove the two failure paths are now surfaced instead of silently
// reported as success, using a fake schema/response shape so the test
// doesn't depend on (or get fooled by) that real-world absence.

vi.mock('@/lib/ranking-intelligence', () => ({
  generateWeeklySummary: vi.fn(async () => ''),
}))

const fromMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: fromMock }),
}))

function req() {
  return new NextRequest('https://seoranko.com/api/cron/send-digests', {
    headers: { authorization: `Bearer test-cron-secret` },
  })
}

describe('GET /api/cron/send-digests', () => {
  const prevSecret = process.env.CRON_SECRET
  const prevKey = process.env.RESEND_API_KEY
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.RESEND_API_KEY = 'test-key'
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.CRON_SECRET = prevSecret
    process.env.RESEND_API_KEY = prevKey
    fromMock.mockReset()
    errorSpy.mockRestore()
    fetchSpy?.mockRestore()
  })

  it('surfaces (does not swallow) a recipient-query error instead of reporting sent: 0 as if there were simply no recipients', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: async () => ({ data: null, error: { message: 'relation "profiles" does not exist' } }),
      }),
    })
    const { GET } = await import('./route')
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/does not exist/)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed to load recipients'),
      expect.stringContaining('does not exist'),
    )
  })

  it('a Resend send that comes back non-OK is reported as a failure, not counted as sent', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: async () => ({ data: [{ id: 'u1', full_name: 'Jane', email: 'jane@example.com', digest_enabled: true }], error: null }) }) }
      }
      // ranking_agent_articles (one .eq) / temporal_claims (two .eq) — a
      // fully chainable stub so either shape resolves; one tracked article
      // so the loop doesn't `continue` early.
      const rows = table === 'ranking_agent_articles'
        ? [{ id: 'a1', title: 'T', keyword: 'k', freshness_status: 'fresh', needs_refresh: false, perplexity_cited: true, cited_competitors: [], last_refresh_at: null, articles: { rank_score: 1, created_at: '2026-01-01' } }]
        : []
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = async () => ({ data: rows, error: null })
      return chain
    })

    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('domain not verified', { status: 403 }),
    )

    const { GET } = await import('./route')
    const res = await GET(req())
    const body = await res.json()

    expect(body.success).toBe(false)
    expect(body.sent).toBe(0)
    expect(body.failed).toBe(1)
    expect(body.failures[0]).toMatchObject({ email: 'jane@example.com', status: 403 })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Resend rejected send for jane@example.com'),
    )
  })

  it('a Resend send that comes back OK is counted as sent, with no failures reported', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: async () => ({ data: [{ id: 'u1', full_name: 'Jane', email: 'jane@example.com', digest_enabled: true }], error: null }) }) }
      }
      const rows = table === 'ranking_agent_articles'
        ? [{ id: 'a1', title: 'T', keyword: 'k', freshness_status: 'fresh', needs_refresh: false, perplexity_cited: true, cited_competitors: [], last_refresh_at: null, articles: { rank_score: 1, created_at: '2026-01-01' } }]
        : []
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = async () => ({ data: rows, error: null })
      return chain
    })

    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    const { GET } = await import('./route')
    const res = await GET(req())
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.sent).toBe(1)
    expect(body.failed).toBe(0)
    expect(body.failures).toEqual([])
  })
})
