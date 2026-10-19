import { NextResponse, type NextRequest } from 'next/server'
import { isLegacyDashboardPath } from '@/lib/legacy-dashboard-routes'
import { redirectAuthCodeIfNeeded } from '@/lib/auth/auth-callback-middleware'

// Public routes — never require auth
const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/blog',
  '/tools',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Auth code safety net — before any other routing (Site URL fallback lands
  // recovery links on /?code=…).
  const codeRedirect = redirectAuthCodeIfNeeded(request)
  if (codeRedirect) return codeRedirect

  // Always allow public paths and API auth routes
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/tools') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/public') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Check Supabase session cookie.
  // Large sessions are split by @supabase/ssr into chunked cookies named
  // `sb-<ref>-auth-token.0`, `.1`, … so match with includes(), not endsWith().
  const isAuthenticated = request.cookies.getAll().some(
    (c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'),
  )

  // Protect dashboard — redirect unauthenticated users to login
  if (!isAuthenticated && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Legacy content/keyword/ranking surfaces → Overview (temporary 307).
  // Page files stay in the tree; only the URL becomes unreachable.
  if (isAuthenticated && isLegacyDashboardPath(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', request.url), 307)
  }

  return NextResponse.next()
}

export const config = {
  // Broad matcher so ?code= on / (Site URL fallback) is caught.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
