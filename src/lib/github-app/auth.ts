/**
 * GitHub App JWT + short-lived installation tokens (repo-scoped when possible).
 * Never persist installation access tokens.
 */

import 'server-only'
import { createSign } from 'crypto'
import { loadGithubAppRecord } from './store'

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

/** RS256 JWT for GitHub App authentication (max 10 minutes). */
export function createGithubAppJwt(appId: number, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: String(appId),
    }),
  )
  const data = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(data)
  const sig = signer.sign(privateKeyPem)
  return `${data}.${b64url(sig)}`
}

export type MintInstallationTokenInput = {
  installationId: number
  /** Prefer repo-scoped tokens — never mint a blanket token when repos are known. */
  repositories?: string[]
  repositoryIds?: number[]
}

export type MintedInstallationToken = {
  token: string
  expiresAt: string
  repositories: string[]
}

/**
 * Mint a short-lived installation access token.
 * When `repositories` / `repositoryIds` are provided, the token is repo-scoped.
 */
export async function mintInstallationAccessToken(
  input: MintInstallationTokenInput,
): Promise<MintedInstallationToken> {
  const app = await loadGithubAppRecord()
  if (!app) throw new Error('GitHub App is not configured')

  const jwt = createGithubAppJwt(app.appId, app.privateKeyPem)
  const body: Record<string, unknown> = {}
  if (input.repositoryIds && input.repositoryIds.length > 0) {
    body.repository_ids = input.repositoryIds
  } else if (input.repositories && input.repositories.length > 0) {
    body.repositories = input.repositories
  }

  const res = await fetch(
    `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub installation token mint failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    token: string
    expires_at: string
    repositories?: Array<{ full_name?: string; name?: string }>
  }
  const repos =
    data.repositories?.map((r) => r.full_name || r.name || '').filter(Boolean) ??
    input.repositories ??
    []
  return { token: data.token, expiresAt: data.expires_at, repositories: repos }
}

/**
 * Verify the signed-in GitHub user can see `installationId` via GET /user/installations.
 * Requires a user-to-server OAuth access token from the App.
 */
export async function userHasInstallation(
  userAccessToken: string,
  installationId: number,
): Promise<boolean> {
  const res = await fetch('https://api.github.com/user/installations?per_page=100', {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return false
  const data = (await res.json()) as {
    installations?: Array<{ id: number }>
  }
  return (data.installations ?? []).some((i) => Number(i.id) === installationId)
}

/**
 * Prove the App exists for these credentials before we persist anything.
 * Calls GET https://api.github.com/app with a freshly minted App JWT.
 */
export async function verifyGithubAppJwtAlive(input: {
  appId: number
  privateKeyPem: string
}): Promise<
  | {
      ok: true
      status: 200
      name: string | null
      slug: string | null
      ownerLogin: string | null
      ownerType: string | null
      ownerId: number | null
      raw: Record<string, unknown>
    }
  | { ok: false; status: number; error: string; rawBodyPreview: string }
> {
  const jwt = createGithubAppJwt(input.appId, input.privateKeyPem)
  const res = await fetch('https://api.github.com/app', {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = null
  }
  if (res.status !== 200 || !json) {
    const msg =
      (json && typeof json.message === 'string' && json.message) ||
      `GET /app failed (${res.status})`
    return {
      ok: false,
      status: res.status,
      error: msg,
      rawBodyPreview: text.slice(0, 400),
    }
  }
  const owner = (json.owner as { login?: string; type?: string; id?: number } | undefined) || null
  return {
    ok: true,
    status: 200,
    name: json.name != null ? String(json.name) : null,
    slug: json.slug != null ? String(json.slug) : null,
    ownerLogin: owner?.login ? String(owner.login) : null,
    ownerType: owner?.type ? String(owner.type) : null,
    ownerId: owner?.id != null ? Number(owner.id) : null,
    raw: json,
  }
}

/** Exchange OAuth code (request_oauth_on_install) for a user access token. */
export async function exchangeOauthCodeForUserToken(code: string): Promise<string> {
  const app = await loadGithubAppRecord()
  if (!app) throw new Error('GitHub App is not configured')

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    throw new Error(`GitHub OAuth token exchange failed (${res.status})`)
  }
  const data = (await res.json()) as { access_token?: string; error?: string }
  if (!data.access_token) {
    throw new Error(data.error || 'GitHub OAuth token missing')
  }
  return data.access_token
}
