/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/pages.ts
// §10 item 8 — helpers for stamping stage onto the `pages` shadow record as
// the existing pipeline runs. Does not change what the pipeline does; only
// records where a unit of work currently sits (§3).

export const STAGE = {
  DISCOVER: 0,
  KEYWORDS: 1,
  PLAN: 2,
  BRIEF: 3,
  WRITE: 4,
  QA: 5,
  PUBLISH: 6,
  MONITOR: 7,
  DEFEND: 8
} as const

export type StageNumber = typeof STAGE[keyof typeof STAGE]

export const STAGE_NAME: Record<number, string> = {
  0: 'Discover', 1: 'Keywords', 2: 'Plan', 3: 'Brief',
  4: 'Write', 5: 'QA', 6: 'Publish', 7: 'Monitor', 8: 'Defend'
}

/**
 * Create the shadow `pages` row for a new unit of work entering the line at
 * Station 1 (a keyword was given). Returns the page id, or null on failure —
 * callers must not let this block article generation (§9 rule 5: this is
 * instrumentation, not a new gate).
 */
export async function startPage(
  supabase: any,
  params: { userId: string; primaryKeyword: string; intent?: string | null }
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('pages')
      .insert({
        user_id: params.userId,
        stage: STAGE.KEYWORDS,
        status: 'in_progress',
        primary_keyword: params.primaryKeyword,
        intent: params.intent ?? null
      })
      .select('id')
      .single()
    if (error) { console.error('[pages] startPage failed:', error); return null }
    return data.id
  } catch (err) {
    console.error('[pages] startPage failed:', err)
    return null
  }
}

/**
 * A URL is registered for tracking (RANKO Track "Add article"). This is
 * currently the closest thing this codebase has to a Publish (6) gate:
 * §3 — "publishing without entering rank tracking means the page has fallen
 * off the line." Most tracked URLs were written outside SEORANKO, so there is
 * no earlier-stage pages row to advance — this creates one starting at
 * Publish, honestly reflecting that Discover/Keywords/Plan/Brief/Write/QA
 * happened elsewhere (or before this instrumentation existed).
 */
export async function enterAtPublish(
  supabase: any,
  params: { userId: string; keyword: string; url: string }
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('pages')
      .insert({
        user_id: params.userId,
        stage: STAGE.MONITOR,
        status: 'in_progress',
        primary_keyword: params.keyword,
        url: params.url,
        published_at: new Date().toISOString(),
        last_action: 'entered tracking'
      })
      .select('id')
      .single()
    if (error) { console.error('[pages] enterAtPublish failed:', error); return null }
    return data.id
  } catch (err) {
    console.error('[pages] enterAtPublish failed:', err)
    return null
  }
}

/** Advance a page's stage. Never throws — instrumentation must not break the pipeline. */
export async function stampStage(
  supabase: any,
  pageId: string | null,
  stage: StageNumber,
  extra: Record<string, any> = {}
): Promise<void> {
  if (!pageId) return
  try {
    await supabase
      .from('pages')
      .update({ stage, updated_at: new Date().toISOString(), ...extra })
      .eq('id', pageId)
  } catch (err) {
    console.error(`[pages] stampStage(${STAGE_NAME[stage]}) failed:`, err)
  }
}

/** Mark a page done at its current stage (e.g. generation completed, QA passed). */
export async function completePage(
  supabase: any,
  pageId: string | null,
  extra: Record<string, any> = {}
): Promise<void> {
  if (!pageId) return
  try {
    await supabase
      .from('pages')
      .update({ status: 'done', updated_at: new Date().toISOString(), ...extra })
      .eq('id', pageId)
  } catch (err) {
    console.error('[pages] completePage failed:', err)
  }
}

/** Mark a page blocked (e.g. generation failed) with a reason in last_action. */
export async function blockPage(
  supabase: any,
  pageId: string | null,
  reason: string
): Promise<void> {
  if (!pageId) return
  try {
    await supabase
      .from('pages')
      .update({ status: 'blocked', last_action: reason, updated_at: new Date().toISOString() })
      .eq('id', pageId)
  } catch (err) {
    console.error('[pages] blockPage failed:', err)
  }
}
