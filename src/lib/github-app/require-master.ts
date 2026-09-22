/**
 * Owner (master) session gate for /admin routes.
 */

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'

export type MasterAuth =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; error: string }

export async function requireMasterUser(): Promise<MasterAuth> {
  const masterEmail = process.env.MASTER_EMAIL?.trim()
  if (!masterEmail) {
    return { ok: false, status: 401, error: 'MASTER_EMAIL is not configured' }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { ok: false, status: 401, error: 'Auth is not configured' }
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
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  if (user.email !== masterEmail) {
    return { ok: false, status: 403, error: 'Forbidden — owner account only' }
  }
  return { ok: true, user }
}
