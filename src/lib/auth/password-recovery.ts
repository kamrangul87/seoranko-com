/**
 * Password recovery helpers — redirect URL must be listed in Supabase Auth
 * → URL Configuration → Redirect URLs.
 */

export const PASSWORD_RESET_PATH = '/reset-password'
export const FORGOT_PASSWORD_PATH = '/forgot-password'

/** Production redirect used by forgot-password emails. */
export const PASSWORD_RESET_REDIRECT_WWW =
  'https://www.seoranko.com/reset-password'

/** Apex twin — also required in Supabase Redirect URLs. */
export const PASSWORD_RESET_REDIRECT_APEX =
  'https://seoranko.com/reset-password'

/**
 * Prefer the current origin so apex / www / preview stay consistent.
 * Falls back to the www production URL when window is unavailable.
 */
export function passwordResetRedirectTo(
  origin?: string | null,
): string {
  const o = (origin || '').replace(/\/$/, '')
  if (o.startsWith('http://') || o.startsWith('https://')) {
    return `${o}${PASSWORD_RESET_PATH}`
  }
  return PASSWORD_RESET_REDIRECT_WWW
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8
}
