/**
 * Allow only same-origin relative paths for post-auth redirects.
 * Rejects protocol-relative (`//evil`), backslash tricks, and absolute URLs.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (raw == null) return fallback
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/')) return fallback
  if (trimmed.startsWith('//')) return fallback
  if (trimmed.includes('\\')) return fallback
  if (trimmed.includes('://')) return fallback
  // Block path traversal and encoded tricks
  if (trimmed.includes('..')) return fallback
  return trimmed
}

export const AUTH_CALLBACK_PATH = '/auth/callback'

/** redirectTo for resetPasswordForEmail / emailRedirectTo. */
export function authCallbackRedirectTo(
  origin: string,
  next: string,
): string {
  const o = origin.replace(/\/$/, '')
  const n = safeNextPath(next, '/dashboard')
  return `${o}${AUTH_CALLBACK_PATH}?next=${encodeURIComponent(n)}`
}
