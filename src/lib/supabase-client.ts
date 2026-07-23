import { createBrowserClient } from '@supabase/ssr'

// Single shared instance — all client components must use this
// so they share the same auth session.
let _client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseClient(): ReturnType<typeof createBrowserClient> {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _client!
}

export const supabase = getSupabaseClient()
