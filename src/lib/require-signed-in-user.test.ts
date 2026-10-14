import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser },
  }),
}))

describe('requireSignedInUser', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockReset()
  })

  it('returns 401 when there is no session', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { requireSignedInUser } = await import('./require-signed-in-user')
    const result = await requireSignedInUser()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(401)
  })

  it('allows a normal signed-in non-master user', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'customer@example.com' } },
    })
    const { requireSignedInUser } = await import('./require-signed-in-user')
    const result = await requireSignedInUser()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.email).toBe('customer@example.com')
  })
})
