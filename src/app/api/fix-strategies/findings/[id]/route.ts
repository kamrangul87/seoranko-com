import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { persistedToUiFinding } from '@/lib/fix-strategies/findings-ui/map-persisted'
import { getFixFlow } from '@/lib/fix-strategies/findings-ui/fix-flow-store'

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

  const store = getFindingsStore()
  const row = await store.getFinding(params.id)
  if (!row || row.userId !== user.id) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }
  if (row.bucket === 'internal') {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }

  const evidence = await store.listEvidenceForFinding(row.id)
  const finding = persistedToUiFinding(row, evidence)
  const fixFlow = await getFixFlow(params.id, user.id)
  return NextResponse.json({ finding, fixFlow })
}
