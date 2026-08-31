import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { runCitationCheck } from '@/lib/ai-visibility/run-citation-check'
import { AI_VISIBILITY_PHASE_NOTE } from '@/lib/ai-visibility/config'

export const maxDuration = 300

async function authUser() {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const { data: { user } } = await authClient.auth.getUser()
  return user
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** POST { siteId, trigger? } — run citation check now. */
export async function POST(req: NextRequest) {
  try {
    const user = await authUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const trigger =
      body.trigger === 'first_connect' || body.trigger === 'weekly_cron' ? body.trigger : 'manual'

    const result = await runCitationCheck({
      supabase: serviceClient(),
      userId: user.id,
      siteId,
      trigger,
      promptIds: Array.isArray(body.promptIds) ? body.promptIds : undefined,
    })

    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    console.error('[ai-visibility/run]', err)
    return NextResponse.json({ error: 'Citation check failed', phaseNote: AI_VISIBILITY_PHASE_NOTE }, { status: 500 })
  }
}

/** GET ?siteId= — latest runs + results summary. */
export async function GET(req: NextRequest) {
  try {
    const user = await authUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const supabase = serviceClient()
    const { data: runs } = await supabase
      .from('ai_visibility_runs')
      .select('id, started_at, finished_at, status, prompt_count, citation_rate, mention_rate, cost_usd, cost_breakdown, trigger')
      .eq('user_id', user.id)
      .eq('site_id', siteId)
      .order('started_at', { ascending: false })
      .limit(12)

    const latest = runs?.[0]
    let results: unknown[] = []
    if (latest) {
      const { data } = await supabase
        .from('ai_visibility_results')
        .select('id, prompt_text, engine, mentioned, cited, competitor_domains, diagnostic, cost_usd, checked_at')
        .eq('run_id', latest.id)
        .order('checked_at', { ascending: true })
      results = data || []
    }

    const prev = runs?.[1]
    return NextResponse.json({
      ok: true,
      phaseNote: AI_VISIBILITY_PHASE_NOTE,
      runs: runs || [],
      latestResults: results,
      trend: {
        citationRate: latest?.citation_rate ?? null,
        previousCitationRate: prev?.citation_rate ?? null,
        mentionRate: latest?.mention_rate ?? null,
        previousMentionRate: prev?.mention_rate ?? null,
        costUsd: latest?.cost_usd ?? null,
      },
    })
  } catch (err) {
    console.error('[ai-visibility/run GET]', err)
    return NextResponse.json({ error: 'Could not load history' }, { status: 500 })
  }
}
