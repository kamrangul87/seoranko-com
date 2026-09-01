import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { generateContentBrief, type BriefMode, type ContentBrief } from '@/lib/content-brief-generator'
import {
  canFixCitationGap,
  citationGapBadgeText,
  type CitationGapContext,
} from '@/lib/ai-visibility/citation-gap-brief'
import type { DuplicateCohortBriefContext } from '@/lib/index-diagnosis/types'
import { duplicateCohortBriefBadgeText } from '@/lib/index-diagnosis/duplicate-cohort-brief'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
  )
}

function briefResponse(row: {
  id: string
  seed_keyword: string
  market: string | null
  brief: ContentBrief
  ai_visibility_result_id: string | null
  citation_engine: string | null
  citation_prompt: string | null
}) {
  const citationGap =
    row.ai_visibility_result_id && row.citation_prompt && row.citation_engine
      ? {
          resultId: row.ai_visibility_result_id,
          prompt: row.citation_prompt,
          engine: row.citation_engine,
          badge: citationGapBadgeText(row.citation_prompt, row.citation_engine),
        }
      : null
  return {
    ok: true,
    id: row.id,
    seedKeyword: row.seed_keyword,
    market: row.market || 'Global',
    brief: row.brief,
    aiVisibilityResultId: row.ai_visibility_result_id,
    citationGap,
  }
}

/** GET ?id= — load a saved brief. Without id, list the user's recent briefs. */
export async function GET(req: NextRequest) {
  const supabase = authClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id') || ''
  if (id) {
    const { data, error } = await supabase
      .from('content_briefs')
      .select('id, seed_keyword, market, brief, ai_visibility_result_id, citation_engine, citation_prompt')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data) return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
    return NextResponse.json(briefResponse(data as Parameters<typeof briefResponse>[0]))
  }

  const { data, error } = await supabase
    .from('content_briefs')
    .select('id, seed_keyword, market, created_at, ai_visibility_result_id, citation_engine, citation_prompt')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(12)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({
    ok: true,
    briefs: (data || []).map((row) => ({
      id: row.id,
      seedKeyword: row.seed_keyword,
      market: row.market,
      createdAt: row.created_at,
      citationGap: row.ai_visibility_result_id
        ? {
            resultId: row.ai_visibility_result_id,
            prompt: row.citation_prompt,
            engine: row.citation_engine,
            badge: row.citation_prompt && row.citation_engine
              ? citationGapBadgeText(row.citation_prompt, row.citation_engine)
              : null,
          }
        : null,
    })),
  })
}

/**
 * Content Brief from the user's seed keyword only.
 * Optional aiVisibilityResultId pre-fills the request with a citation-gap diagnostic
 * and persists the brief ↔ result link.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = authClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const seedIn = typeof body.seedKeyword === 'string' ? body.seedKeyword.trim() : ''
    const market = typeof body.market === 'string' ? body.market : 'Global'
    const mode = (body.mode as BriefMode | undefined) || undefined
    const siteId = typeof body.siteId === 'string' ? body.siteId : null
    const resultId = typeof body.aiVisibilityResultId === 'string' ? body.aiVisibilityResultId : ''
    const indexCohort = body.indexDiagnosisCohort as DuplicateCohortBriefContext | undefined

    let seed = seedIn
    let citationGap: CitationGapContext | undefined
    let duplicateCohort: DuplicateCohortBriefContext | undefined

    if (indexCohort?.cohortLabel && indexCohort?.cohortId) {
      duplicateCohort = indexCohort
      seed = seed || indexCohort.sharedTopic || indexCohort.suggestedBriefTitle || indexCohort.cohortLabel
    }

    if (resultId) {
      const { data: result, error: resultErr } = await supabase
        .from('ai_visibility_results')
        .select('id, prompt_text, engine, cited, diagnostic')
        .eq('id', resultId)
        .maybeSingle()
      if (resultErr) return NextResponse.json({ error: resultErr.message }, { status: 400 })
      if (!result) return NextResponse.json({ error: 'Citation result not found' }, { status: 404 })

      const diagnostic = (result.diagnostic || null) as {
        status?: string
        finding?: string
        gaps?: string[]
        error?: string
      } | null
      if (!canFixCitationGap(Boolean(result.cited), diagnostic)) {
        return NextResponse.json(
          { error: 'This citation result has no actionable diagnostic to turn into a brief.' },
          { status: 400 },
        )
      }
      seed = seed || String(result.prompt_text || '')
      citationGap = {
        resultId: result.id,
        prompt: String(result.prompt_text || seed),
        engine: String(result.engine || ''),
        finding: diagnostic?.finding || '',
        gaps: Array.isArray(diagnostic?.gaps) ? diagnostic.gaps.map(String) : [],
      }
    }

    if (!seed) return NextResponse.json({ error: 'seedKeyword is required' }, { status: 400 })

    const brief = await generateContentBrief({
      seedKeyword: seed,
      mode,
      market,
      citationGap,
      indexDiagnosisCohort: duplicateCohort,
    })

    const indexDiagnosisCohortMeta = duplicateCohort
      ? {
          sharedTopic: duplicateCohort.sharedTopic,
          suggestedBriefTitle: duplicateCohort.suggestedBriefTitle,
          badge: duplicateCohortBriefBadgeText(duplicateCohort),
        }
      : null

    const insertRow = {
      user_id: user.id,
      site_id: siteId,
      seed_keyword: seed,
      mode: brief.mode,
      market,
      brief,
      ai_visibility_result_id: citationGap?.resultId || null,
      citation_engine: citationGap?.engine || null,
      citation_prompt: citationGap?.prompt || null,
    }

    const { data: saved, error: saveErr } = await supabase
      .from('content_briefs')
      .insert(insertRow)
      .select('id, seed_keyword, market, brief, ai_visibility_result_id, citation_engine, citation_prompt')
      .maybeSingle()

    if (saveErr || !saved) {
      // Table may not be live yet — still return the generated brief so the UI loop works.
      console.error('[copilot/brief] persist', saveErr?.message)
      return NextResponse.json({
        ok: true,
        id: null,
        seedKeyword: seed,
        market,
        brief,
        aiVisibilityResultId: citationGap?.resultId || null,
        citationGap: citationGap
          ? {
              resultId: citationGap.resultId,
              prompt: citationGap.prompt,
              engine: citationGap.engine,
              badge: citationGapBadgeText(citationGap.prompt, citationGap.engine),
            }
          : null,
        indexDiagnosisCohort: indexDiagnosisCohortMeta,
        persistError: saveErr?.message || 'Could not save brief',
      })
    }

    return NextResponse.json({
      ...briefResponse(saved as Parameters<typeof briefResponse>[0]),
      indexDiagnosisCohort: indexDiagnosisCohortMeta,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Brief failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
