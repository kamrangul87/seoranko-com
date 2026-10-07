/**
 * Master-only one-run Fix Agent gate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canRunFixAgent,
  shouldShowFixMySiteButton,
} from './master-gate'

describe('canRunFixAgent / Fix my site button', () => {
  beforeEach(() => {
    process.env.MASTER_EMAIL = 'owner@example.com'
  })
  afterEach(() => {
    delete process.env.MASTER_EMAIL
  })

  it('allows master email', () => {
    expect(canRunFixAgent('owner@example.com')).toBe(true)
    expect(canRunFixAgent('Owner@Example.com')).toBe(true)
    expect(shouldShowFixMySiteButton(true)).toBe(true)
  })

  it('denies non-master — button absent', () => {
    expect(canRunFixAgent('other@example.com')).toBe(false)
    expect(shouldShowFixMySiteButton(false)).toBe(false)
    expect(shouldShowFixMySiteButton(canRunFixAgent('other@example.com'))).toBe(
      false,
    )
  })

  it('denies when MASTER_EMAIL unset', () => {
    delete process.env.MASTER_EMAIL
    expect(canRunFixAgent('owner@example.com')).toBe(false)
  })
})

describe('requireMasterUser → 403 for non-master (route gate)', () => {
  afterEach(() => {
    delete process.env.MASTER_EMAIL
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('returns 403 when authenticated user is not MASTER_EMAIL', async () => {
    process.env.MASTER_EMAIL = 'owner@example.com'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'

    vi.doMock('next/headers', () => ({
      cookies: () => ({ get: () => undefined }),
    }))
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: () => ({
        auth: {
          getUser: async () => ({
            data: { user: { id: 'u-non', email: 'other@example.com' } },
          }),
        },
      }),
    }))

    const { requireMasterUser } = await import('@/lib/github-app/require-master')
    const result = await requireMasterUser()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.error).toMatch(/owner account only|Forbidden/i)
    }
  })

  it('returns 401 when unauthenticated', async () => {
    process.env.MASTER_EMAIL = 'owner@example.com'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'

    vi.doMock('next/headers', () => ({
      cookies: () => ({ get: () => undefined }),
    }))
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: null } }),
        },
      }),
    }))

    const { requireMasterUser } = await import('@/lib/github-app/require-master')
    const result = await requireMasterUser()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
    }
  })
})
