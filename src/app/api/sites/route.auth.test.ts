import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireSignedInUser = vi.fn()

vi.mock('@/lib/require-signed-in-user', () => ({
  requireSignedInUser: (...args: unknown[]) => requireSignedInUser(...args),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  }),
}))

describe('GET /api/sites auth', () => {
  beforeEach(() => {
    vi.resetModules()
    requireSignedInUser.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  })

  it('allows a normal signed-in non-master user (not 403)', async () => {
    requireSignedInUser.mockResolvedValue({
      ok: true,
      user: { id: 'u-customer', email: 'customer@example.com' },
    })
    const { GET } = await import('./route')
    const req = new NextRequest('http://localhost/api/sites?domain=example.com')
    const res = await GET(req)
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(410)
    expect([200, 404]).toContain(res.status)
  })

  it('rejects unauthenticated callers with 401', async () => {
    const { NextResponse } = await import('next/server')
    requireSignedInUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    const { GET } = await import('./route')
    const req = new NextRequest('http://localhost/api/sites?domain=example.com')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
