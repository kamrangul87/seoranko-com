/**
 * Regression: llms-txt / security-headers must never rubber-stamp verified.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  verifyLiveHtml,
  verifyLlmsTxtLive,
  verifySecurityHeadersLive,
} from './fix-agent'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Fix Agent live verification honesty', () => {
  it('verifyLiveHtml never returns ok for llms-txt or security-headers', () => {
    expect(verifyLiveHtml('llms-txt', '<html><body>ok</body></html>').ok).toBe(false)
    expect(verifyLiveHtml('security-headers', '<html><body>ok</body></html>').ok).toBe(false)
    expect(verifyLiveHtml('llms-txt', '').detail).toMatch(/live GET/i)
    expect(verifyLiveHtml('security-headers', '').detail).toMatch(/header/i)
  })

  it('verifyLlmsTxtLive fails when file is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Not Found', { status: 404 })),
    )
    const v = await verifyLlmsTxtLive('https://example.com/')
    expect(v.ok).toBe(false)
    expect(v.detail).toMatch(/404|not verified/i)
  })

  it('verifyLlmsTxtLive passes only when live body is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# Example\n\n> hello world site', { status: 200 })),
    )
    const v = await verifyLlmsTxtLive('https://example.com/')
    expect(v.ok).toBe(true)
    expect(v.detail).toMatch(/Confirmed live llms\.txt/i)
  })

  it('verifySecurityHeadersLive fails when headers absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )
    const v = await verifySecurityHeadersLive('https://example.com/')
    expect(v.ok).toBe(false)
    expect(v.detail).toMatch(/missing|incomplete/i)
  })

  it('verifySecurityHeadersLive passes when immediate headers present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html></html>', {
            status: 200,
            headers: {
              'x-frame-options': 'SAMEORIGIN',
              'x-content-type-options': 'nosniff',
            },
          }),
      ),
    )
    const v = await verifySecurityHeadersLive('https://example.com/')
    expect(v.ok).toBe(true)
  })
})
