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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check Supabase session cookie
  const hasSupabaseCookie = request.cookies.getAll().some(
    (c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token')
  )

  // Check master session cookie
  const masterToken = request.cookies.get(MASTER_COOKIE)?.value
  const isMaster = masterToken ? await verifyMasterCookie(masterToken) : false

  const isAuthenticated = hasSupabaseCookie || isMaster

  if (!isAuthenticated && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isAuthenticated && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/signup'],
}
