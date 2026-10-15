import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetches: Array<{ url: string; method: string }> = []

describe('closeStuckFixturePrs parallel + non-blocking reset', () => {
  beforeEach(() => {
    fetches.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        fetches.push({ url, method })

        if (url.includes('/pulls?state=open')) {
          return new Response(
            JSON.stringify([
              { number: 7, head: { ref: 'fix/a' }, state: 'open' },
              { number: 8, head: { ref: 'fix/b' }, state: 'open' },
              { number: 12, head: { ref: 'fix/c' }, state: 'open' },
            ]),
            { status: 200 },
          )
        }
        if (url.match(/\/pulls\/\d+$/) && method === 'GET') {
          const n = Number(url.split('/').pop())
          return new Response(
            JSON.stringify({
              number: n,
              state: 'open',
              head: { ref: `fix/${n}` },
            }),
            { status: 200 },
          )
        }
        if (url.match(/\/pulls\/\d+$/) && method === 'PATCH') {
          return new Response(JSON.stringify({ state: 'closed' }), {
            status: 200,
          })
        }
        if (url.includes('/comments') && method === 'POST') {
          return new Response(JSON.stringify({ id: 1 }), { status: 201 })
        }
        if (url.includes('/git/refs/') && method === 'DELETE') {
          return new Response(null, { status: 204 })
        }
        // resetFixtureMainToSeed GitHub calls
        if (url.includes('/git/ref/heads/seed')) {
          return new Response(
            JSON.stringify({ object: { sha: 'seedsha0001' } }),
            { status: 200 },
          )
        }
        if (url.includes('/git/ref/heads/main') && method === 'GET') {
          return new Response(
            JSON.stringify({ object: { sha: 'mainsha0001' } }),
            { status: 200 },
          )
        }
        if (url.includes('/git/commits/seedsha0001')) {
          return new Response(
            JSON.stringify({ tree: { sha: 'treesha0001' } }),
            { status: 200 },
          )
        }
        if (url.includes('/compare/')) {
          return new Response(JSON.stringify({ status: 'diverged' }), {
            status: 200,
          })
        }
        if (url.endsWith('/git/commits') && method === 'POST') {
          return new Response(JSON.stringify({ sha: 'resetsha0001' }), {
            status: 201,
          })
        }
        if (url.includes('/git/refs/heads/main') && method === 'PATCH') {
          return new Response(JSON.stringify({ object: { sha: 'resetsha0001' } }), {
            status: 200,
          })
        }
        return new Response('{}', { status: 200 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('closes every open PR in parallel (not a hardcoded list)', async () => {
    const { closeStuckFixturePrs } = await import('./reset-seed')
    const result = await closeStuckFixturePrs({ accessToken: 't' })
    expect(result.closed.sort((a, b) => a - b)).toEqual([7, 8, 12])
    const patchCalls = fetches.filter(
      (f) => f.method === 'PATCH' && /\/pulls\/\d+$/.test(f.url),
    )
    expect(patchCalls).toHaveLength(3)
  })

  it('resetFixtureMainToSeed does not await PR cleanup before reset commit', async () => {
    const { resetFixtureMainToSeed } = await import('./reset-seed')
    const result = await resetFixtureMainToSeed({ accessToken: 't' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mainSha).toBe('resetsha0001')
    }
    // Reset commit path must have run (create commit + update main).
    expect(
      fetches.some((f) => f.url.endsWith('/git/commits') && f.method === 'POST'),
    ).toBe(true)
    expect(
      fetches.some(
        (f) => f.url.includes('/git/refs/heads/main') && f.method === 'PATCH',
      ),
    ).toBe(true)
  })
})
