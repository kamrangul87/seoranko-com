import { describe, it, expect, vi } from 'vitest'
import { verifyLogoUrlReachable } from './logo-reachability'

describe('verifyLogoUrlReachable', () => {
  it('reports reachable for a 200 response with an image content-type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
    })
    const result = await verifyLogoUrlReachable('https://cdn.example.com/logo.png', fetchImpl as unknown as typeof fetch)
    expect(result.reachable).toBe(true)
  })

  it('reports unreachable for a 404 (the Clearbit-shutdown shape)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    })
    const result = await verifyLogoUrlReachable('https://logo.clearbit.com/example.com', fetchImpl as unknown as typeof fetch)
    expect(result.reachable).toBe(false)
    expect(result.reason).toContain('404')
  })

  it('reports unreachable when the response is 200 but not an image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
    })
    const result = await verifyLogoUrlReachable('https://example.com/not-an-image', fetchImpl as unknown as typeof fetch)
    expect(result.reachable).toBe(false)
    expect(result.reason).toContain('not an image')
  })

  it('reports unreachable when the fetch itself throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'))
    const result = await verifyLogoUrlReachable('https://cdn.example.com/logo.png', fetchImpl as unknown as typeof fetch)
    expect(result.reachable).toBe(false)
    expect(result.reason).toContain('unreachable')
  })

  it('calls fetch with GET, not HEAD', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/webp' }),
    })
    await verifyLogoUrlReachable('https://cdn.example.com/logo.webp', fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledWith('https://cdn.example.com/logo.webp', expect.objectContaining({ method: 'GET' }))
  })
})
