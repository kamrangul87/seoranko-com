import { safeNextPath } from './safe-next-path'

export const AUTH_HASH_STORAGE_KEY = 'seoranko_auth_hash'

/** Inline script for root layout — runs before supabase-js can strip the hash. */
export const AUTH_HASH_CAPTURE_SCRIPT = `(function(){try{var h=location.hash||'';if(h.indexOf('access_token')!==-1||h.indexOf('error=')!==-1||h.indexOf('type=signup')!==-1||h.indexOf('type=recovery')!==-1){sessionStorage.setItem('${AUTH_HASH_STORAGE_KEY}',h);}}catch(e){}})();`

/** Prefer the pre-React capture, then the live hash. */
export function readCapturedAuthHash(): string {
  if (typeof window === 'undefined') return ''
  try {
    const stored = sessionStorage.getItem(AUTH_HASH_STORAGE_KEY)
    if (stored) {
      sessionStorage.removeItem(AUTH_HASH_STORAGE_KEY)
      return stored
    }
  } catch {
    /* private mode / blocked storage */
  }
  return window.location.hash || ''
}

export type AuthHashParams = {
  accessToken: string | null
  refreshToken: string | null
  type: string | null
  error: string | null
  errorCode: string | null
}

const AUTH_HASH_KEYS = [
  'access_token',
  'refresh_token',
  'type',
  'error',
  'error_code',
  'error_description',
] as const

/**
 * Parse a URL fragment from Supabase implicit/email links
 * (`#access_token=…&type=signup` or `#error=…`).
 * Returns null when the hash is not an auth callback.
 */
export function parseAuthHash(hash: string): AuthHashParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const looksLikeAuth = AUTH_HASH_KEYS.some((k) => params.has(k))
  if (!looksLikeAuth) return null
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
    error: params.get('error'),
    errorCode: params.get('error_code'),
  }
}

export function isAuthHashPresent(hash: string): boolean {
  return parseAuthHash(hash) != null
}

/** Where to send the user after a successful email-link session. */
export function nextPathAfterAuthType(
  type: string | null | undefined,
  nextParam?: string | null,
): string {
  if (type === 'recovery') return '/reset-password'
  return safeNextPath(nextParam, '/dashboard')
}

export function loginPathAfterAuthFailure(hash: AuthHashParams | null): string {
  if (
    hash?.error ||
    hash?.errorCode === 'otp_expired' ||
    hash?.errorCode === 'access_denied'
  ) {
    return '/login?error=link_expired'
  }
  return '/login?confirmed=1'
}
