import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AUTH_CALLBACK_PATH, safeNextPath } from './safe-next-path'

/**
 * Safety net: any page that receives ?code= outside /auth/callback is
 * redirected there so exchangeCodeForSession always runs.
 * type=recovery → next=/reset-password; otherwise next=/dashboard (or
 * an already-safe `next` query if present).
 */
export function redirectAuthCodeIfNeeded(
  request: NextRequest,
): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl
  if (pathname.startsWith(AUTH_CALLBACK_PATH)) return null

  const code = searchParams.get('code')
  if (!code) return null

  const type = searchParams.get('type')
  const existingNext = searchParams.get('next')
  let next: string
  if (type === 'recovery') {
    next = '/reset-password'
  } else if (existingNext) {
    next = safeNextPath(existingNext, '/dashboard')
  } else if (pathname === '/' || pathname === '') {
    // Site URL fallback for recovery emails lands on /?code=… with no type.
    next = '/reset-password'
  } else {
    next = '/dashboard'
  }

  const dest = request.nextUrl.clone()
  dest.pathname = AUTH_CALLBACK_PATH
  dest.search = ''
  dest.searchParams.set('code', code)
  dest.searchParams.set('next', next)
  return NextResponse.redirect(dest)
}
