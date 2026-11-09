import { describe, expect, it, vi } from 'vitest'
import { loadOwnedConnectedSite } from './owned-site'

describe('loadOwnedConnectedSite', () => {
  it('returns null when the site is missing or owned by someone else', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      })),
    }
    const out = await loadOwnedConnectedSite(
      supabase as never,
      'user-1',
      'site-1',
    )
    expect(out).toBeNull()
  })

  it('returns the row when user_id matches', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'site-1', domain: 'example.com', brand: 'Ex' },
                error: null,
              }),
            }),
          }),
        }),
      })),
    }
    const out = await loadOwnedConnectedSite(
      supabase as never,
      'user-1',
      'site-1',
    )
    expect(out).toEqual({ id: 'site-1', domain: 'example.com', brand: 'Ex' })
  })
})
