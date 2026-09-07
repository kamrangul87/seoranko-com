import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { runFixAgent } from '@/lib/fix-agent'
import type { PageAuditIssue } from '@/lib/page-audit-engine'
import { attemptUrlsMatch } from '@/lib/site-connection-lookup'
import { normalizeUrl } from '@/lib/supabase/audit-db'

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

/** GET ?url=&siteId= — list recent Fix Agent attempts for this URL (for the user). */
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
    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!url && !siteId) {
      return NextResponse.json({ error: 'url or siteId is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    let query = supabase
      .from('fix_agent_attempts')
      .select(
        'id, site_id, issue_id, issue_title, auto_kind, strategy, attempt_number, status, diff_summary, verification_detail, error_message, revertible, score_before, score_after, created_at, human_task, reverted_at, target_url',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (siteId) {
      query = query.eq('site_id', siteId)
    }

    const { data, error } = await query
    if (error) {
      console.error('[fix-agent GET]', error.message)
      return NextResponse.json({ error: 'Could not load attempts' }, { status: 500 })
    }

    const rows = data || []
    // Exact target_url match is brittle (www / trailing slash). Filter after normalizeUrl.
    const filtered = url
      ? rows.filter((row: { target_url?: string }) =>
          attemptUrlsMatch(String(row.target_url || ''), url),
        )
      : rows

    // If URL filter emptied the list but siteId was provided, fall back to same-host
    // attempts so Failed attempts still surface after slight URL drift.
    const attempts =
      filtered.length > 0 || !siteId || !url
        ? filtered
        : rows.filter((row: { target_url?: string }) => {
            try {
              const a = new URL(normalizeUrl(String(row.target_url || 'https://invalid.local')))
              const b = new URL(normalizeUrl(url))
              return a.hostname === b.hostname
            } catch {
              return false
            }
          })

    return NextResponse.json({ ok: true, attempts })
  } catch (err) {
    console.error('[fix-agent GET]', err)
    return NextResponse.json({ error: 'Could not load attempts' }, { status: 500 })
  }
}
