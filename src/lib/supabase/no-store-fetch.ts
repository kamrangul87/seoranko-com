/**
 * Next.js App Router caches `fetch` GETs by default. supabase-js / @supabase/ssr
 * use fetch for PostgREST, so server reads can return stale rows across CAS
 * retries and successive queries in the same invocation (see e2e write_version
 * bug). Every server-side Supabase client must use this fetch.
 */
export function supabaseNoStoreFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: 'no-store',
  })
}
