/**
 * CSRF state for GitHub App Manifest flow.
 *
 * Production Next.js forbids cookies().set() inside Server Components —
 * only Server Actions / Route Handlers may mutate cookies. State is minted
 * in the /api/github/app/manifest/start Route Handler immediately before
 * redirecting to GitHub (10-minute TTL).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

export const GITHUB_APP_MANIFEST_STATE_COOKIE = 'seoranko_gh_app_manifest_state'
/** Manifest conversion codes are short-lived — keep CSRF window tight. */
export const MANIFEST_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function signingKey(): Buffer {
  const raw =
    process.env.SITE_CONNECTION_ENCRYPTION_KEY?.trim() ||
    process.env.MASTER_EMAIL?.trim() ||
    'seoranko-github-app-state'
  return createHmac('sha256', 'seoranko-gh-app-state').update(raw).digest()
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url')
}

/**
 * Create a new signed state value. Does NOT set cookies — call from a
 * Route Handler right before redirecting to GitHub.
 */
export function mintManifestState(): string {
  const nonce = randomBytes(24).toString('base64url')
  const exp = String(Date.now() + MANIFEST_STATE_TTL_MS)
  const body = `${nonce}.${exp}`
  return `${body}.${sign(body)}`
}

/** @deprecated Use mintManifestState — cookie writes are illegal in RSC. */
export function mintManifestStateCookie(): string {
  return mintManifestState()
}

/** Clear legacy cookie from a Route Handler only. */
export function clearManifestStateCookie(): void {
  cookies().set(GITHUB_APP_MANIFEST_STATE_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export type ManifestStateVerify =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'expired' }

/** Verify query `state` signature and expiry (≤10 minutes). */
export function verifyManifestStateDetailed(queryState: string | null): ManifestStateVerify {
  if (!queryState) return { ok: false, reason: 'missing' }

  const parts = queryState.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [nonce, exp, sig] = parts
  if (!nonce || !exp || !sig) return { ok: false, reason: 'malformed' }
  const body = `${nonce}.${exp}`
  const expected = sign(body)
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_signature' }
    }
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
  const expMs = Number(exp)
  if (!Number.isFinite(expMs) || Date.now() > expMs) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true }
}

/** Verify query `state` signature and expiry. */
export function verifyManifestState(queryState: string | null): boolean {
  return verifyManifestStateDetailed(queryState).ok
}

export function manifestStateErrorMessage(reason: ManifestStateVerify extends { ok: false; reason: infer R } ? R : never): string {
  switch (reason) {
    case 'expired':
      return 'Manifest session expired (over 10 minutes). Start again from the setup page.'
    case 'missing':
      return 'Missing state. Start again from the setup page.'
    case 'malformed':
    case 'bad_signature':
      return 'Invalid state. Start again from the setup page.'
    default:
      return 'Invalid state. Start again from the setup page.'
  }
}
