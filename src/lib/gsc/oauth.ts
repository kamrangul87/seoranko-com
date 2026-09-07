/**
 * Google Search Console OAuth helpers (webmasters.readonly).
 * Tokens are never logged. Refresh tokens stored via site-connection-crypto.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { encryptCredentialsJson, decryptCredentialsJson } from '@/lib/site-connection-crypto'

export const GSC_OAUTH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

export function requireGscOAuthConfig(): {
  clientId: string
  clientSecret: string
  redirectUri: string
} {
  const clientId = process.env.GOOGLE_GSC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_GSC_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  const redirectUri =
    process.env.GOOGLE_GSC_REDIRECT_URI ||
    process.env.GOOGLE_REDIRECT_URI ||
    ''

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_GSC_CLIENT_ID and GOOGLE_GSC_CLIENT_SECRET are required to connect Google Search Console.',
    )
  }
  if (!redirectUri) {
    throw new Error(
      'GOOGLE_GSC_REDIRECT_URI is required (e.g. https://www.seoranko.com/api/gsc/callback).',
    )
  }
  return { clientId, clientSecret, redirectUri }
}

function stateKey(): Buffer {
  const raw =
    process.env.SITE_CONNECTION_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.GOOGLE_GSC_CLIENT_SECRET
  if (!raw) {
    throw new Error('Missing signing secret for GSC OAuth state')
  }
  return Buffer.from(raw)
}

export type GscOAuthMode = 'account' | 'site'

export type GscOAuthState = {
  userId: string
  /** account = multi-property onboarding; site = reconnect a single site mapping */
  mode: GscOAuthMode
  /** Required when mode is `site`. Absent for account-level connect. */
  siteId?: string
  nonce: string
  exp: number
}

export function signGscOAuthState(payload: GscOAuthState): string {
  if (payload.mode === 'site' && !payload.siteId) {
    throw new Error('siteId is required for site-mode GSC OAuth state')
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', stateKey()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyGscOAuthState(token: string): GscOAuthState {
  const [body, sig] = token.split('.')
  if (!body || !sig) throw new Error('Invalid OAuth state')
  const expected = createHmac('sha256', stateKey()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid OAuth state signature')
  }
  const raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<GscOAuthState> & {
    siteId?: string
  }
  if (!raw.userId || !raw.exp) {
    throw new Error('OAuth state missing required fields')
  }
  // Legacy payloads (pre-account onboarding) always carried siteId and implied site mode.
  const mode: GscOAuthMode =
    raw.mode === 'account' || raw.mode === 'site'
      ? raw.mode
      : raw.siteId
        ? 'site'
        : (() => {
            throw new Error('OAuth state missing required fields')
          })()
  if (mode === 'site' && !raw.siteId) {
    throw new Error('OAuth state missing required fields')
  }
  if (Date.now() > raw.exp) throw new Error('OAuth state expired — try connecting again')
  return {
    userId: raw.userId,
    mode,
    siteId: raw.siteId,
    nonce: typeof raw.nonce === 'string' ? raw.nonce : '',
    exp: raw.exp,
  }
}

export function buildGscAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireGscOAuthConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GSC_OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `${GOOGLE_AUTH}?${params.toString()}`
}

export function encryptGscRefreshToken(refreshToken: string): string {
  if (!refreshToken) throw new Error('Missing GSC refresh token')
  return encryptCredentialsJson({ refresh_token: refreshToken })
}

export function decryptGscRefreshToken(ciphertext: string): string {
  const obj = decryptCredentialsJson(ciphertext)
  const token = obj.refresh_token
  if (typeof token !== 'string' || !token) {
    throw new Error('GSC refresh token missing from encrypted blob')
  }
  return token
}

export async function exchangeGscAuthCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresIn: number
}> {
  const { clientId, clientSecret, redirectUri } = requireGscOAuthConfig()
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      typeof data.error_description === 'string'
        ? data.error_description
        : `Google token exchange failed (${res.status})`,
    )
  }
  if (typeof data.access_token !== 'string') {
    throw new Error('Google token response missing access_token')
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 3600,
  }
}

export async function refreshGscAccessToken(refreshToken: string): Promise<{
  accessToken: string
  expiresIn: number
}> {
  const { clientId, clientSecret } = requireGscOAuthConfig()
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof data.error_description === 'string'
        ? data.error_description
        : `Google token refresh failed (${res.status})`
    const err = new Error(msg) as Error & { code?: string }
    if (data.error === 'invalid_grant' || res.status === 400 || res.status === 401) {
      err.code = 'gsc_token_expired'
    }
    throw err
  }
  if (typeof data.access_token !== 'string') {
    throw new Error('Google refresh response missing access_token')
  }
  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 3600,
  }
}
