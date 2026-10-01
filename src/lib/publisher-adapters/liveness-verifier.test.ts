import { describe, expect, it } from 'vitest'
import { checkOnce, looksLikeAuthWall } from './liveness-verifier'

describe('looksLikeAuthWall', () => {
  it('detects password login forms', () => {
    expect(
      looksLikeAuthWall(
        '<html><body><form><input type="password" name="password"/><button>Sign in</button></form></body></html>',
      ),
    ).toBe(true)
  })

  it('does not flag ordinary article HTML', () => {
    expect(
      looksLikeAuthWall(
        '<html><head><title>EV charger guide</title></head><body><h1>EV charger guide</h1><p>Install tips.</p></body></html>',
      ),
    ).toBe(false)
  })
})

describe('checkOnce auth-wall guard', () => {
  it('hard-fails a 200 login page even when the content marker is present', async () => {
    const marker = 'EV charger guide'
    const html = `<html><body><h1>${marker}</h1><form action="/login"><input type="password" name="password"/><button>Log in</button></form></body></html>`
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })) as typeof fetch
    try {
      const result = await checkOnce({
        liveUrl: 'https://example.com/post',
        contentMarker: marker,
        expectedCanonicalUrl: 'https://example.com/post',
      })
      expect(result.verdict).toBe('HARD_FAILURE')
      expect(result.detail.toLowerCase()).toContain('login')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
