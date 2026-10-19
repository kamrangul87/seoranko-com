/**
 * Cookie-backed anon client for App Router route handlers / server code.
 * Always no-store.
 */

import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from './ssr-client'

export function createRouteAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not configured')
  }
  const cookieStore = cookies()
  return createSupabaseSsrClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
    },
  })
}
