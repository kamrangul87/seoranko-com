import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export const maxDuration = 30

async function getAuthedUser() {
  const cookieStore = cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  )
  const { data: { user } } = await supabaseAuth.auth.getUser()
  return user
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Soft-delete an article (ROI Delete). Falls back to hard delete if soft-delete column is missing. */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const supabase = serviceClient()
    const soft = await supabase
      .from('articles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .is('deleted_at', null)

    if (soft.error) {
      // Column missing or soft-delete unavailable — hard delete so the UI still works
      const hard = await supabase
        .from('articles')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)
      if (hard.error) return NextResponse.json({ error: hard.error.message }, { status: 500 })
      return NextResponse.json({ success: true, mode: 'hard' })
    }

    return NextResponse.json({ success: true, mode: 'soft' })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

/** Restore a soft-deleted article (ROI Retrieve). */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { id, action } = body as { id?: string; action?: string }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const supabase = serviceClient()

    if (action === 'restore') {
      const { error } = await supabase
        .from('articles')
        .update({ deleted_at: null })
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    if (action === 'download') {
      const { data, error } = await supabase
        .from('articles')
        .select('id, title, keyword, content')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data) return NextResponse.json({ error: 'Article not found' }, { status: 404 })
      if (!data.content) {
        return NextResponse.json({ error: 'No content saved for this article' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        id: data.id,
        title: data.title,
        keyword: data.keyword,
        content: data.content,
      })
    }

    return NextResponse.json({ error: 'action must be restore or download' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
