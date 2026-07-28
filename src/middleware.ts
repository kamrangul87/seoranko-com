import { NextResponse, type NextRequest } from 'next/server'

// Public routes — never require auth
const PUBLIC_PATHS = ['/', '/pricing', '/login', '/signup', '/blog']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow public paths and API auth routes
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Check Supabase session cookie.
  // Large sessions are split by @supabase/ssr into chunked cookies named
  // `sb-<ref>-auth-token.0`, `.1`, … so match with includes(), not endsWith().
  const isAuthenticated = request.cookies.getAll().some(
    (c) => c.name.startsWith('sb-') && c.name.includes('-auth-token')
  )

  // Protect dashboard — redirect unauthenticated users to login
  if (!isAuthenticated && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/login',
    '/signup',
  ],
}
