/**
 * Session gate for customer (non-master) API routes.
 * Returns the Supabase user or a 401 response — never requires MASTER_EMAIL.
 */

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'

export type SignedInAuth =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse }

export async function requireSignedInUser(): Promise<SignedInAuth> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Auth is not configured' },
        { status: 401 },
      ),
    }
  }

  const cookieStore = cookies()
  const authClient = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
    },
  })
  const {
    data: { user },
  } = await authClient.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { ok: true, user }
}
