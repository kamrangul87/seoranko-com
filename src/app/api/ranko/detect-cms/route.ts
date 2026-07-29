import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { detectCMS } from '@/lib/site-adapters'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain } = await req.json().catch(() => ({ domain: '' }))
  if (!domain) return NextResponse.json({ platform: 'unknown' })

  const platform = await detectCMS(domain)
  return NextResponse.json({ platform })
}
