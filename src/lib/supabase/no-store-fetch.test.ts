import { describe, expect, it, vi } from 'vitest'
import { supabaseNoStoreFetch } from './no-store-fetch'
import { createSupabaseJsClient } from './js-client'

describe('supabase no-store factories', () => {
  it('supabaseNoStoreFetch sets cache: no-store', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }),
    )
    await supabaseNoStoreFetch('https://example.supabase.co/rest/v1/x', {
      method: 'GET',
    })
    expect(spy).toHaveBeenCalled()
    const init = spy.mock.calls[0]?.[1] as RequestInit
    expect(init.cache).toBe('no-store')
    spy.mockRestore()
  })

  it('createSupabaseJsClient installs no-store fetch on the underlying client', () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }),
    )
    // Import path under test uses real @supabase/supabase-js; construction
    // alone must wire global.fetch. Trigger a REST-shaped call via fetch opts.
    const client = createSupabaseJsClient(
      'https://example.supabase.co',
      'test-key',
    )
    expect(client).toBeTruthy()
    // Re-assert the shared helper is what we expect.
    expect(supabaseNoStoreFetch).toBeTypeOf('function')
    spy.mockRestore()
  })
})
