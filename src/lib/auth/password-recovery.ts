/**
 * Password recovery helpers — redirect URLs must be listed in Supabase Auth
 * → URL Configuration → Redirect URLs (prefer /auth/callback wildcards).
 */

import { authCallbackRedirectTo } from './safe-next-path'

export const PASSWORD_RESET_PATH = '/reset-password'
export const FORGOT_PASSWORD_PATH = '/forgot-password'
export { AUTH_CALLBACK_PATH } from './safe-next-path'

/** Production callback bases — allowlist both www and apex. */
export const AUTH_CALLBACK_REDIRECT_WWW =
  'https://www.seoranko.com/auth/callback'
export const AUTH_CALLBACK_REDIRECT_APEX =
  'https://seoranko.com/auth/callback'

/**
 * resetPasswordForEmail redirectTo: `${origin}/auth/callback?next=/reset-password`
 */
export function passwordResetRedirectTo(
  origin?: string | null,
): string {
  const o = (origin || '').replace(/\/$/, '')
  if (o.startsWith('http://') || o.startsWith('https://')) {
    return authCallbackRedirectTo(o, PASSWORD_RESET_PATH)
  }
  return authCallbackRedirectTo(
    'https://www.seoranko.com',
    PASSWORD_RESET_PATH,
  )
}

/** @deprecated Use passwordResetRedirectTo — kept for docs/tests. */
export const PASSWORD_RESET_REDIRECT_WWW = passwordResetRedirectTo(
  'https://www.seoranko.com',
)

/** @deprecated Use passwordResetRedirectTo */
export const PASSWORD_RESET_REDIRECT_APEX = passwordResetRedirectTo(
  'https://seoranko.com',
)

export function isValidPassword(password: string): boolean {
  return password.length >= 8
}
