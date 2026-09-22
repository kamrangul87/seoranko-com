/**
 * CSRF state for GitHub App manifest flow (httpOnly cookie).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

export const GITHUB_APP_MANIFEST_STATE_COOKIE = 'seoranko_gh_app_manifest_state'
const TTL_MS = 60 * 60 * 1000 // 1 hour (manifest flow limit)

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

/** Create a new state value and set the httpOnly cookie. */
export function mintManifestStateCookie(): string {
  const nonce = randomBytes(24).toString('base64url')
  const exp = String(Date.now() + TTL_MS)
  const body = `${nonce}.${exp}`
  const state = `${body}.${sign(body)}`
  cookies().set(GITHUB_APP_MANIFEST_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(TTL_MS / 1000),
  })
  return state
}

export function clearManifestStateCookie(): void {
  cookies().set(GITHUB_APP_MANIFEST_STATE_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

/** Verify query `state` matches cookie and is unexpired. */
export function verifyManifestState(queryState: string | null): boolean {
  if (!queryState) return false
  const cookieVal = cookies().get(GITHUB_APP_MANIFEST_STATE_COOKIE)?.value
  if (!cookieVal || cookieVal !== queryState) return false

  const parts = queryState.split('.')
  if (parts.length !== 3) return false
  const [nonce, exp, sig] = parts
  if (!nonce || !exp || !sig) return false
  const body = `${nonce}.${exp}`
  const expected = sign(body)
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  } catch {
    return false
  }
  const expMs = Number(exp)
  if (!Number.isFinite(expMs) || Date.now() > expMs) return false
  return true
}
