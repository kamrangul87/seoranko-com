import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fetchPageContent, isSafePublicUrl } from '@/lib/fetch-page-content'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value } } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { url } = await req.json().catch(() => ({ url: undefined }))

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  // This endpoint fetches a URL supplied by the caller, so refuse anything
  // pointing at the local network or a non-HTTP scheme.
  if (!isSafePublicUrl(url)) {
    return NextResponse.json(
      { error: 'That URL cannot be fetched — only public http(s) pages are supported.' },
      { status: 400 }
    )
  }

  const content = await fetchPageContent(url)

  if (!content) {
    return NextResponse.json(
      { error: 'Could not fetch that page — it may be private, blocked, or offline.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ success: true, content })
}
