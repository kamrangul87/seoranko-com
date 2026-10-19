/**
 * Server-side wrapper for `createClient` from `@supabase/supabase-js`.
 * Always installs no-store fetch. Prefer {@link createServiceRoleClient} when
 * using the service role key.
 */

import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { supabaseNoStoreFetch } from './no-store-fetch'

export function createSupabaseJsClient(
  url: string,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: Record<string, any>,
): SupabaseClient {
  return createClient(url, key, {
    ...(options ?? {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      ...(options?.auth ?? {}),
    },
    global: {
      ...(options?.global ?? {}),
      fetch: supabaseNoStoreFetch,
    },
  })
}
