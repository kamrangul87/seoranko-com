import { describe, expect, it, vi, beforeEach } from 'vitest'

const INSTALLATIONS = [
  {
    installation_id: 1,
    account_login: 'shared-org',
    repository_selection: 'all',
    uninstalled_at: null,
    suspended_at: null,
    user_id: 'user-a',
  },
  {
    installation_id: 2,
    account_login: 'shared-org',
    repository_selection: 'all',
    uninstalled_at: null,
    suspended_at: null,
    user_id: 'user-b',
  },
]

function chainable(rows: typeof INSTALLATIONS) {
  const state: { userIdFilter?: string } = {}
  const builder: Record<string, unknown> = {
    select: () => builder,
    is: () => builder,
    eq: (col: string, val: string) => {
      if (col === 'user_id') state.userIdFilter = val
      return builder
    },
    order: () => builder,
    limit: async () => {
      const filtered = state.userIdFilter
        ? rows.filter((r) => r.user_id === state.userIdFilter)
        : rows
      return { data: filtered, error: null }
    },
  }
  return builder
}

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => ({
    from: () => chainable(INSTALLATIONS),
  }),
}))

vi.mock('./auth', () => ({
  createGithubAppJwt: () => 'fake-jwt',
  mintInstallationAccessToken: async (input: { installationId: number; repositories?: string[] }) => ({
    token: `token-for-installation-${input.installationId}`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    repositories: input.repositories || [],
  }),
}))

vi.mock('./store', () => ({
  loadGithubAppRecord: async () => ({
    appId: 1,
    privateKeyPem: 'fake',
  }),
  upsertInstallation: async () => {},
}))

describe('resolveGithubAppRepoCreds — cross-tenant scoping', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('without userId, matches whichever installation the account_login resolves to first (legacy/diagnostic callers only)', async () => {
    const { resolveGithubAppRepoCreds } = await import('./resolve-repo-creds')
    const creds = await resolveGithubAppRepoCreds({ owner: 'shared-org', repo: 'site' })
    expect(creds?.installationId).toBe(1)
  })

  it('scopes to the installation linked to the given userId, not any installation matching the account login', async () => {
    const { resolveGithubAppRepoCreds } = await import('./resolve-repo-creds')

    const credsForA = await resolveGithubAppRepoCreds({
      owner: 'shared-org',
      repo: 'site',
      userId: 'user-a',
    })
    expect(credsForA?.installationId).toBe(1)
    expect(credsForA?.accessToken).toBe('token-for-installation-1')

    const credsForB = await resolveGithubAppRepoCreds({
      owner: 'shared-org',
      repo: 'site',
      userId: 'user-b',
    })
    expect(credsForB?.installationId).toBe(2)
    expect(credsForB?.accessToken).toBe('token-for-installation-2')
  })

  it('returns null for a userId with no linked installation, even though another user has one for that org', async () => {
    const { resolveGithubAppRepoCreds } = await import('./resolve-repo-creds')
    const creds = await resolveGithubAppRepoCreds({
      owner: 'shared-org',
      repo: 'site',
      userId: 'user-c',
    })
    expect(creds).toBeNull()
  })
})
