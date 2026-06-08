import { NextResponse, type NextRequest } from 'next/server'

const MASTER_COOKIE = "seoranko_master"

async function verifyMasterCookie(token: string): Promise<boolean> {
  const masterEmail = process.env.MASTER_EMAIL
  const masterPassword = process.env.MASTER_PASSWORD
  if (!masterEmail || !masterPassword) return false
  const encoder = new TextEncoder()
  const data = encoder.encode(`${masterEmail}:${masterPassword}:master`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const expected = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return token === expected
}

// Public routes — never require auth
const PUBLIC_PATHS = ['/', '/pricing', '/auth/login', '/auth/signup', '/blog']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow public paths and API auth routes
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Check Supabase session cookie
  const hasSupabaseCookie = request.cookies.getAll().some(
    (c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token')
  )

  // Check master session cookie
  const masterToken = request.cookies.get(MASTER_COOKIE)?.value
  const isMaster = masterToken ? await verifyMasterCookie(masterToken) : false

  const isAuthenticated = hasSupabaseCookie || isMaster

  // Protect dashboard — redirect unauthenticated users to login
  if (!isAuthenticated && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/auth/login',
    '/auth/signup',
  ],
}
