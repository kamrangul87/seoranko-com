import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * GET — diagnose whether fix_agent_attempts (and site_csp_policies) exist on hosted DB.
 * Used when Failed attempts vanish after reload — usually the migration was never applied.
 */
export async function GET(_req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const attempts = await supabase.from('fix_agent_attempts').select('id', { count: 'exact', head: true })
    const csp = await supabase.from('site_csp_policies').select('id', { count: 'exact', head: true })

    const attemptsOk = !attempts.error
    const cspOk = !csp.error

    return NextResponse.json({
      ok: attemptsOk,
      fix_agent_attempts: {
        exists: attemptsOk,
        error: attempts.error?.message || null,
        count: attempts.count ?? null,
      },
      site_csp_policies: {
        exists: cspOk,
        error: csp.error?.message || null,
      },
      migration:
        attemptsOk && cspOk
          ? null
          : 'Apply supabase/migrations/20260907160000_fix_agent_attempts_ensure_csp.sql on hosted Supabase (SQL editor), then re-run Fix Agent.',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Health check failed' },
      { status: 500 },
    )
  }
}
