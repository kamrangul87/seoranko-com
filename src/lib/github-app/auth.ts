/**
 * GitHub App JWT + short-lived installation tokens (repo-scoped when possible).
 * Never persist installation access tokens.
 */

import 'server-only'
import { createSign, type KeyObject } from 'crypto'
import {
  inspectAndNormalizeGithubAppPem,
  pemInspectPublicMeta,
  type PemInspectResult,
} from './pem'
import { loadGithubAppRecord } from './store'

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

export type GithubAppJwtClaims = {
  alg: 'RS256'
  typ: 'JWT'
  iat: number
  exp: number
  iss: string
  /** exp - iat (must be ≤ 600 for GitHub). */
  lifetimeSeconds: number
  /** Seconds iat is behind wall-clock now (should be 60). */
  iatSkewSeconds: number
}

export type GithubAppJwtBuild = {
  jwt: string
  claims: GithubAppJwtClaims
  pem: ReturnType<typeof pemInspectPublicMeta>
}

/**
 * Build an RS256 App JWT.
 * - iat = now - 60 (required clock skew allowance)
 * - exp = now + 540 so (exp - iat) = 600 (GitHub max)
 * - iss = App ID string
 * - PEM normalized (collapsed newlines repaired; PKCS#1 → PKCS#8)
 */
export function createGithubAppJwtDetailed(
  appId: number,
  privateKeyPem: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): GithubAppJwtBuild {
  const inspect = inspectAndNormalizeGithubAppPem(privateKeyPem)
  if (!inspect.signerAccepts || !inspect.keyObject) {
    throw new Error(inspect.signerError || 'PEM could not be parsed by the signer')
  }

  const iat = nowSeconds - 60
  const exp = nowSeconds + 9 * 60 // 540s ahead; lifetime from iat = 600
  const headerObj = { alg: 'RS256' as const, typ: 'JWT' as const }
  const payloadObj = { iat, exp, iss: String(appId) }
  const header = b64url(JSON.stringify(headerObj))
  const payload = b64url(JSON.stringify(payloadObj))
  const data = `${header}.${payload}`

  const signer = createSign('RSA-SHA256')
  signer.update(data)
  const sig = signer.sign(inspect.keyObject as KeyObject)

  return {
    jwt: `${data}.${b64url(sig)}`,
    claims: {
      alg: 'RS256',
      typ: 'JWT',
      iat,
      exp,
      iss: String(appId),
      lifetimeSeconds: exp - iat,
      iatSkewSeconds: nowSeconds - iat,
    },
    pem: pemInspectPublicMeta(inspect),
  }
}

/** RS256 JWT for GitHub App authentication (max 10 minutes). */
export function createGithubAppJwt(appId: number, privateKeyPem: string): string {
  return createGithubAppJwtDetailed(appId, privateKeyPem).jwt
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

export type GithubAppJwtProbe =
  | {
      ok: true
      status: 200
      name: string | null
      slug: string | null
      ownerLogin: string | null
      ownerType: string | null
      ownerId: number | null
      raw: Record<string, unknown>
      githubRequestId: string | null
      claims: GithubAppJwtClaims
      pem: ReturnType<typeof pemInspectPublicMeta>
    }
  | {
      ok: false
      status: number
      error: string
      rawBody: string
      githubRequestId: string | null
      claims: GithubAppJwtClaims | null
      pem: ReturnType<typeof pemInspectPublicMeta> | null
    }

/**
 * Prove the App exists for these credentials before we persist anything.
 * Calls GET https://api.github.com/app with a freshly minted App JWT.
 */
export async function verifyGithubAppJwtAlive(input: {
  appId: number
  privateKeyPem: string
}): Promise<GithubAppJwtProbe> {
  let built: GithubAppJwtBuild
  try {
    built = createGithubAppJwtDetailed(input.appId, input.privateKeyPem)
  } catch (e) {
    const inspect = inspectAndNormalizeGithubAppPem(input.privateKeyPem)
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : 'jwt_build_failed',
      rawBody: '',
      githubRequestId: null,
      claims: null,
      pem: pemInspectPublicMeta(inspect),
    }
  }

  const res = await fetch('https://api.github.com/app', {
    headers: {
      Authorization: `Bearer ${built.jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seoranko-github-app',
    },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  const githubRequestId = res.headers.get('x-github-request-id')
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
      rawBody: text.slice(0, 2000),
      githubRequestId,
      claims: built.claims,
      pem: built.pem,
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
    githubRequestId,
    claims: built.claims,
    pem: built.pem,
  }
}

/**
 * Full owner diagnostic for JWT + GET /app. Never includes key material.
 */
export async function diagnoseGithubAppJwt(input: {
  appId: number
  privateKeyPem: string
}): Promise<Record<string, unknown>> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const inspect: PemInspectResult = inspectAndNormalizeGithubAppPem(input.privateKeyPem)
  const pemMeta = pemInspectPublicMeta(inspect)

  if (!inspect.signerAccepts) {
    return {
      ok: false,
      stage: 'pem_parse',
      wall_clock_unix: nowSeconds,
      app_id_input: input.appId,
      pem: pemMeta,
      claims: null,
      github: null,
      notes: [
        'Signer could not load the PEM. Collapsed newlines (spaces instead of line breaks) are a common cause.',
        'GitHub App keys are usually PKCS#1 (BEGIN RSA PRIVATE KEY); we convert to PKCS#8 before signing when parse succeeds.',
      ],
    }
  }

  const built = createGithubAppJwtDetailed(input.appId, input.privateKeyPem, nowSeconds)
  const probe = await verifyGithubAppJwtAlive({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem,
  })

  return {
    ok: probe.ok,
    stage: probe.ok ? 'get_app_ok' : 'get_app',
    wall_clock_unix: nowSeconds,
    app_id_input: input.appId,
    pem: pemMeta,
    claims: built.claims,
    checks: {
      alg_is_rs256: built.claims.alg === 'RS256',
      iss_equals_app_id: built.claims.iss === String(input.appId),
      iat_is_now_minus_60: built.claims.iatSkewSeconds === 60,
      exp_minus_iat_lte_600: built.claims.lifetimeSeconds <= 600,
      exp_not_more_than_600_ahead_of_now: built.claims.exp - nowSeconds <= 600,
    },
    github: probe.ok
      ? {
          status: 200,
          request_id: probe.githubRequestId,
          name: probe.name,
          slug: probe.slug,
          owner_login: probe.ownerLogin,
          owner_type: probe.ownerType,
          owner_id: probe.ownerId,
          raw: probe.raw,
        }
      : {
          status: probe.status,
          request_id: probe.githubRequestId,
          error: probe.error,
          raw_body: probe.rawBody,
        },
    notes: [
      'iat is set to now-60s so a slightly fast local clock does not make iat appear in the future to GitHub.',
      'GitHub returns HTTP 404 "Integration not found" for a deleted App OR an invalid JWT signature (wrong key / wrong App ID).',
      'This response never includes the private key or JWT.',
    ],
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
