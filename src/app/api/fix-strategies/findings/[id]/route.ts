import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  buildDemoFindings,
  getFixFlow,
} from '@/lib/fix-strategies/findings-ui'

export const dynamic = 'force-dynamic'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    },
  )
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const finding = buildDemoFindings().find((f) => f.id === params.id)
  if (!finding) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }
  const fixFlow = getFixFlow(params.id)
  return NextResponse.json({ finding, fixFlow })
}
