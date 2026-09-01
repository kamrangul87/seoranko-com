import { createClient } from '@supabase/supabase-js'
import type { IndexDiagnosisResult } from './types'

export async function persistIndexDiagnosisRun(
  userId: string,
  result: IndexDiagnosisResult,
): Promise<string | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )
    const { data, error } = await supabase
      .from('index_diagnosis_runs')
      .insert({
        user_id: userId,
        domain: result.coverage.domain,
        seed_url: result.coverage.seedUrl,
        verdict_headline: result.verdict.headline,
        coverage: result.coverage,
        pages: result.pages,
        cohorts: result.cohorts,
        top_causes: result.verdict.topCauses,
        indexable_count: result.verdict.indexableCount,
        blocked_count: result.verdict.blockedCount,
        at_risk_count: result.verdict.atRiskCount,
      })
      .select('id')
      .maybeSingle()

    if (error) {
      console.warn('[index-diagnosis] persist failed', error.message)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.warn('[index-diagnosis] persist error', err)
    return null
  }
}
