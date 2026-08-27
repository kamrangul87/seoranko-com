import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { runFixAgent } from '@/lib/fix-agent'
import type { PageAuditIssue } from '@/lib/page-audit-engine'

export const maxDuration = 120

/**
 * POST — run Fix Agent on a connected site only.
 * Body: { url, siteId, issues, scoreBefore?, confirm: true }
 *
 * Never runs against an arbitrary audited URL without an active connection
 * matching siteId. One site per explicit user action.
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    const confirm = body.confirm === true
    const issues = Array.isArray(body.issues) ? (body.issues as PageAuditIssue[]) : []
    const scoreBefore = typeof body.scoreBefore === 'number' ? body.scoreBefore : undefined

    if (!url || !siteId) {
      return NextResponse.json({ error: 'url and siteId are required' }, { status: 400 })
    }
    if (!confirm) {
      return NextResponse.json(
        { error: 'Explicit confirm: true is required — Fix Agent will not run silently or in bulk.' },
        { status: 400 },
      )
    }
    if (issues.length === 0) {
      return NextResponse.json({ error: 'issues array is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const result = await runFixAgent({
      supabase,
      userId: user.id,
      auditUrl: url,
      issues,
      confirmSiteId: siteId,
      scoreBefore,
      langHint: typeof body.langHint === 'string' ? body.langHint : 'en',
    })

    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    console.error('[fix-agent]', err)
    return NextResponse.json({ error: 'Fix Agent failed' }, { status: 500 })
  }
}

/** GET ?url= — list recent Fix Agent attempts for this URL (for the user). */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = req.nextUrl.searchParams.get('url') || ''
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data } = await supabase
      .from('fix_agent_attempts')
      .select(
        'id, issue_id, issue_title, auto_kind, strategy, attempt_number, status, diff_summary, verification_detail, error_message, revertible, score_before, score_after, created_at, human_task, reverted_at',
      )
      .eq('user_id', user.id)
      .eq('target_url', url)
      .order('created_at', { ascending: false })
      .limit(50)

    return NextResponse.json({ ok: true, attempts: data || [] })
  } catch (err) {
    console.error('[fix-agent GET]', err)
    return NextResponse.json({ error: 'Could not load attempts' }, { status: 500 })
  }
}
