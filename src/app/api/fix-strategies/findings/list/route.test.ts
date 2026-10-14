import { beforeEach, describe, expect, it, vi } from 'vitest'

const collectionGet = vi.fn()

vi.mock('../route', () => ({
  dynamic: 'force-dynamic',
  GET: (...args: unknown[]) => collectionGet(...args),
}))

describe('GET /api/fix-strategies/findings/list', () => {
  beforeEach(() => {
    vi.resetModules()
    collectionGet.mockReset()
    collectionGet.mockResolvedValue(
      new Response(JSON.stringify({ findings: [] }), { status: 200 }),
    )
  })

  it('aliases the collection GET (does not fall through to [id])', async () => {
    const { GET } = await import('./route')
    const req = new Request(
      'http://localhost/api/fix-strategies/findings/list?siteId=50b305a3-baab-49ce-8966-04796b8b27c4',
    )
    const res = await GET(req)
    expect(collectionGet).toHaveBeenCalledTimes(1)
    expect(collectionGet.mock.calls[0][0]).toBe(req)
    expect(res.status).toBe(200)
  })
})
