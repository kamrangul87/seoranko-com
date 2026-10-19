import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { safeNextPath } from '@/lib/auth/safe-next-path'

export const dynamic = 'force-dynamic'

/**
 * PKCE / email-link landing: exchange ?code= for a session, then redirect to
 * a safe relative `next` (default /dashboard). On failure → login with
 * error=link_expired.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')
  const origin = url.origin

  if (!code) {
    return NextResponse.redirect(
      new URL('/login?error=link_expired', origin),
    )
  }

  const cookieStore = cookies()
  const supabase = createSupabaseSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(
          cookiesToSet: {
            name: string
            value: string
            options: Record<string, unknown>
          }[],
        ) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(
      new URL('/login?error=link_expired', origin),
    )
  }

  return NextResponse.redirect(new URL(next, origin))
}
