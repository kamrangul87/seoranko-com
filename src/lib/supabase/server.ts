import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from './ssr-client'

/** Cookie-backed server client for RSC / server actions. Always no-store. */
export const createClient = async () => {
  const cookieStore = await cookies()
  return createSupabaseSsrClient(
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
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            /* called from a Server Component — ignore */
          }
        },
      },
    },
  )
}
