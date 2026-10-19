import { NextResponse } from 'next/server'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { cookies } from 'next/headers'
import { detectRecurringIssues } from '@/lib/recurring-issue-detector'


export const dynamic = 'force-dynamic'
export async function GET() {
  const cookieStore = cookies()
  const authClient = createSupabaseSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ alerts: [] })

  const supabase = createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const alerts = await detectRecurringIssues(supabase, user.id)
  return NextResponse.json({ alerts })
}
