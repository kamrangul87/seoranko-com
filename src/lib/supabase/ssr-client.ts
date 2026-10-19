/**
 * Server-side wrapper for `createServerClient` from `@supabase/ssr`.
 * Always installs no-store fetch.
 */

import { createServerClient } from '@supabase/ssr'
import { supabaseNoStoreFetch } from './no-store-fetch'

export function createSupabaseSsrClient(
  url: string,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: { cookies: Record<string, any> } & Record<string, unknown>,
) {
  const { cookies, global: globalOpts, ...rest } = options as {
    cookies: Record<string, unknown>
    global?: Record<string, unknown>
  } & Record<string, unknown>
  return createServerClient(url, key, {
    ...rest,
    cookies,
    global: {
      ...(globalOpts ?? {}),
      fetch: supabaseNoStoreFetch,
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}
