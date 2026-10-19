import { type SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseJsClient } from './js-client'

/**
 * Service-role Supabase client for server-only writes that must bypass RLS
 * (e.g. Stripe webhook → subscriptions). Never import from client components.
 * Always uses no-store fetch (Next.js must not cache PostgREST GETs).
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) required')
  }
  return createSupabaseJsClient(url, key)
}
