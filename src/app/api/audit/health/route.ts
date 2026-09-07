import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * GET /api/audit/health
 * Diagnose whether Index Diagnosis + Link Graph tables exist and are writable
 * enough for cross-reload persistence. Mirrors fix-agent/health.
 */
export async function GET() {
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
      { auth: { persistSession: false } },
    )

    const diagnosis = await supabase
      .from('index_diagnosis_runs')
      .select('id', { count: 'exact', head: true })
    const linkAudits = await supabase
      .from('link_graph_audits')
      .select('id', { count: 'exact', head: true })
    const linkFindings = await supabase
      .from('link_findings')
      .select('id', { count: 'exact', head: true })

    const diagnosisOk = !diagnosis.error
    const linkOk = !linkAudits.error && !linkFindings.error
    const ok = diagnosisOk && linkOk

    const missing: string[] = []
    if (!diagnosisOk) missing.push('index_diagnosis_runs')
    if (linkAudits.error) missing.push('link_graph_audits')
    if (linkFindings.error) missing.push('link_findings')

    return NextResponse.json({
      ok,
      index_diagnosis_runs: {
        exists: diagnosisOk,
        error: diagnosis.error?.message || null,
        count: diagnosis.count ?? null,
      },
      link_graph_audits: {
        exists: !linkAudits.error,
        error: linkAudits.error?.message || null,
        count: linkAudits.count ?? null,
      },
      link_findings: {
        exists: !linkFindings.error,
        error: linkFindings.error?.message || null,
        count: linkFindings.count ?? null,
      },
      migration: ok
        ? null
        : `Missing hosted table(s): ${missing.join(', ')}. Apply supabase/migrations/20260901120000_index_diagnosis_runs.sql and 20260902120000_link_graph_audit.sql (or wait for CI db push on main).`,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Health check failed' },
      { status: 500 },
    )
  }
}
